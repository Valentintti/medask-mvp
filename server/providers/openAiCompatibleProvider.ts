import { slotExtractionJsonSchema } from '../../shared/llm/contracts'
import type { QuestionRewriteRequest, SlotExtractionRequest } from '../../src/llm/types'
import { buildQuestionRewritePrompt, QUESTION_REWRITE_SYSTEM_PROMPT } from '../prompts/questionRewritePrompt'
import { buildSlotExtractionPrompt, SLOT_EXTRACTION_SYSTEM_PROMPT } from '../prompts/slotExtractionPrompt'
import type { ProviderUsage, ServerLlmProvider, ServerProviderResult } from '../types'

const MAX_UPSTREAM_BODY_BYTES = 65_536
const JSON_OUTPUT_MAX_TOKENS = 1_200
const REWRITE_MAX_TOKENS = 600
const EXTRACTION_TOOL_NAME = 'submit_slot_extraction'
type FetchLike = typeof fetch
export type ExtractionOutputStrategy = 'deepseek_strict_tool' | 'json_object_fallback'

export interface StructuredOutputStats {
  strictToolRequestCount: number
  jsonObjectFallbackCount: number
  strictFallbackReasonCounts: Record<string, number>
}

export class ProviderRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable = false,
    readonly retryAfterMs: number | null = null,
  ) {
    super(code); this.name = 'ProviderRequestError'
  }
}

function completionEndpoint(baseUrl: string): string {
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`
}

function deepSeekBetaCompletionEndpoint(baseUrl: string): string {
  const url = new URL(baseUrl)
  let path = url.pathname.replace(/\/+$/u, '').replace(/\/chat\/completions$/u, '')
  path = path.replace(/\/(?:v1|beta)$/u, '')
  url.pathname = `${path}/beta/chat/completions`.replace(/\/{2,}/gu, '/')
  url.search = ''; url.hash = ''
  return url.toString()
}

function usageFrom(value: unknown): ProviderUsage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { inputTokens: null, outputTokens: null, totalTokens: null }
  const record = value as Record<string, unknown>
  const number = (item: unknown): number | null => typeof item === 'number' && Number.isFinite(item) ? item : null
  return { inputTokens: number(record.prompt_tokens), outputTokens: number(record.completion_tokens), totalTokens: number(record.total_tokens) }
}

interface CompletionEnvelope { message: Record<string, unknown>; usage: ProviderUsage }
function completionEnvelope(bodyText: string): CompletionEnvelope {
  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>
    const choices = body.choices
    if (!Array.isArray(choices) || choices.length !== 1) throw new Error('choices')
    const first = choices[0]
    if (typeof first !== 'object' || first === null || Array.isArray(first)) throw new Error('choice')
    if ((first as Record<string, unknown>).finish_reason === 'length') throw new ProviderRequestError('truncated_output', 502)
    const message = (first as Record<string, unknown>).message
    if (typeof message !== 'object' || message === null || Array.isArray(message)) throw new Error('message')
    return { message: message as Record<string, unknown>, usage: usageFrom(body.usage) }
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error
    throw new ProviderRequestError('provider_response_invalid', 502)
  }
}

function extractJsonContent(bodyText: string): { rawJson: string; usage: ProviderUsage } {
  const envelope = completionEnvelope(bodyText)
  const content = envelope.message.content
  if (typeof content !== 'string' || !content.trim()) throw new ProviderRequestError('empty_content', 502)
  return { rawJson: content, usage: envelope.usage }
}

function extractStrictToolArguments(bodyText: string): { rawJson: string; usage: ProviderUsage } {
  const envelope = completionEnvelope(bodyText)
  const toolCalls = envelope.message.tool_calls
  if (!Array.isArray(toolCalls) || toolCalls.length !== 1) throw new ProviderRequestError('tool_call_missing', 502)
  const call = toolCalls[0]
  if (typeof call !== 'object' || call === null || Array.isArray(call)) throw new ProviderRequestError('tool_call_missing', 502)
  const fn = (call as Record<string, unknown>).function
  if (typeof fn !== 'object' || fn === null || Array.isArray(fn)) throw new ProviderRequestError('tool_call_missing', 502)
  const functionRecord = fn as Record<string, unknown>
  if (functionRecord.name !== EXTRACTION_TOOL_NAME || typeof functionRecord.arguments !== 'string' || !functionRecord.arguments.trim()) {
    throw new ProviderRequestError('tool_call_missing', 502)
  }
  return { rawJson: functionRecord.arguments, usage: envelope.usage }
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortReason(signal)) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve() }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function abortReason(signal?: AbortSignal): ProviderRequestError {
  const code = signal?.reason instanceof Error && signal.reason.message === 'provider_timeout' ? 'provider_timeout' : 'provider_aborted'
  return new ProviderRequestError(code, code === 'provider_timeout' ? 503 : 499)
}

export interface OpenAiCompatibleProviderOptions {
  apiKey: string
  baseUrl: string
  model: string
  requestTimeoutMs?: number
  fetchFn?: FetchLike
  extractionStrategy?: ExtractionOutputStrategy
  deepSeekStrictToolEnabled?: boolean
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get('retry-after')?.trim()
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

function upstreamError(response: Response): ProviderRequestError {
  if (response.status === 429) return new ProviderRequestError('provider_rate_limited', 429, true, retryAfterMilliseconds(response))
  if ([401, 403].includes(response.status)) return new ProviderRequestError('provider_auth_error', 503)
  if (response.status >= 400 && response.status < 500) return new ProviderRequestError('provider_request_rejected', 502)
  if (response.status >= 500) return new ProviderRequestError('provider_upstream_error', 502, true)
  return new ProviderRequestError('provider_upstream_error', 502)
}

function strictExtractionSchema(): Record<string, unknown> {
  const unsupported = new Set(['minLength', 'maxLength', 'minItems', 'maxItems'])
  const copySupported = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(copySupported)
    if (typeof value !== 'object' || value === null) return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => !unsupported.has(key)).map(([key, item]) => [key, copySupported(item)]))
  }
  const schema = copySupported(slotExtractionJsonSchema) as Record<string, unknown>
  const properties = schema.properties as Record<string, Record<string, unknown>>
  properties.schemaVersion = { type: 'string', enum: ['1.1'] }
  return schema
}

function strictToolRequestBody(model: string, systemPrompt: string, userPrompt: string): string {
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    tools: [{
      type: 'function',
      function: {
        name: EXTRACTION_TOOL_NAME,
        description: '提交经过结构化的预问诊槽位提取候选。',
        strict: true,
        parameters: strictExtractionSchema(),
      },
    }],
    tool_choice: { type: 'function', function: { name: EXTRACTION_TOOL_NAME } },
    temperature: 0,
    max_tokens: JSON_OUTPUT_MAX_TOKENS,
  })
}

function jsonObjectRequestBody(model: string, systemPrompt: string, userPrompt: string, maxTokens: number, stable: boolean): string {
  return JSON.stringify({
    model,
    messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
    response_format: { type: 'json_object' },
    ...(stable ? { temperature: 0 } : {}),
    max_tokens: maxTokens,
  })
}

function canFallbackFromStrict(error: unknown): boolean {
  return error instanceof ProviderRequestError && [
    'provider_request_rejected', 'provider_upstream_error', 'provider_network_error',
    'provider_response_invalid', 'tool_call_missing', 'truncated_output', 'empty_content',
  ].includes(error.code)
}

export class OpenAiCompatibleProvider implements ServerLlmProvider {
  readonly providerAlias = 'openai-compatible'
  readonly modelAlias = 'configured-model'
  private readonly fetchFn: FetchLike
  private strictToolRequestCount = 0
  private jsonObjectFallbackCount = 0
  private readonly strictFallbackReasonCounts: Record<string, number> = {}
  private strictCapability: 'unknown' | 'supported' | 'unsupported' = 'unknown'

  constructor(private readonly options: OpenAiCompatibleProviderOptions) { this.fetchFn = options.fetchFn ?? fetch }

  getStructuredOutputStats(): StructuredOutputStats {
    return {
      strictToolRequestCount: this.strictToolRequestCount,
      jsonObjectFallbackCount: this.jsonObjectFallbackCount,
      strictFallbackReasonCounts: { ...this.strictFallbackReasonCounts },
    }
  }

  extractSlots(input: SlotExtractionRequest, signal?: AbortSignal): Promise<ServerProviderResult> {
    const strategy = this.options.extractionStrategy
      ?? (this.options.deepSeekStrictToolEnabled === true ? 'deepseek_strict_tool' : 'json_object_fallback')
    return this.withTotalTimeout(signal, async (requestSignal, deadline) => {
      if (strategy === 'deepseek_strict_tool' && this.strictCapability !== 'unsupported') {
        this.strictToolRequestCount += 1
        try {
          const completion = await this.requestCompletion(
            deepSeekBetaCompletionEndpoint(this.options.baseUrl),
            strictToolRequestBody(this.options.model, SLOT_EXTRACTION_SYSTEM_PROMPT, buildSlotExtractionPrompt(input)),
            requestSignal,
            deadline,
          )
          const extracted = extractStrictToolArguments(completion.bodyText)
          this.strictCapability = 'supported'
          return this.result(extracted.rawJson, extracted.usage, completion.status, SLOT_EXTRACTION_SYSTEM_PROMPT, buildSlotExtractionPrompt(input), 'deepseek_strict_tool')
        } catch (error) {
          if (!canFallbackFromStrict(error)) throw error
          const reason = error instanceof ProviderRequestError ? error.code : 'unknown'
          // 当前服务进程内缓存明确的 4xx 不支持结果，避免每次请求重复触发已知失败。
          if (reason === 'provider_request_rejected') this.strictCapability = 'unsupported'
          this.strictFallbackReasonCounts[reason] = (this.strictFallbackReasonCounts[reason] ?? 0) + 1
          this.jsonObjectFallbackCount += 1
        }
      }
      const userPrompt = buildSlotExtractionPrompt(input)
      const completion = await this.requestCompletion(
        completionEndpoint(this.options.baseUrl),
        jsonObjectRequestBody(this.options.model, SLOT_EXTRACTION_SYSTEM_PROMPT, userPrompt, JSON_OUTPUT_MAX_TOKENS, true),
        requestSignal,
        deadline,
      )
      const extracted = extractJsonContent(completion.bodyText)
      return this.result(extracted.rawJson, extracted.usage, completion.status, SLOT_EXTRACTION_SYSTEM_PROMPT, userPrompt, 'json_object_fallback')
    })
  }

  rewriteQuestion(input: QuestionRewriteRequest, signal?: AbortSignal): Promise<ServerProviderResult> {
    return this.withTotalTimeout(signal, async (requestSignal, deadline) => {
      const userPrompt = buildQuestionRewritePrompt(input)
      const completion = await this.requestCompletion(
        completionEndpoint(this.options.baseUrl),
        jsonObjectRequestBody(this.options.model, QUESTION_REWRITE_SYSTEM_PROMPT, userPrompt, REWRITE_MAX_TOKENS, false),
        requestSignal,
        deadline,
      )
      const extracted = extractJsonContent(completion.bodyText)
      return this.result(extracted.rawJson, extracted.usage, completion.status, QUESTION_REWRITE_SYSTEM_PROMPT, userPrompt, 'question_rewrite_json_object')
    })
  }

  private result(
    rawJson: string,
    usage: ProviderUsage,
    upstreamStatus: number,
    systemPrompt: string,
    userPrompt: string,
    structuredOutputStrategy: ServerProviderResult['structuredOutputStrategy'],
  ): ServerProviderResult {
    return {
      rawJson,
      inputCharacters: systemPrompt.length + userPrompt.length,
      outputCharacters: rawJson.length,
      usage,
      upstreamStatus,
      structuredOutputStrategy,
    }
  }

  private async withTotalTimeout<T>(
    signal: AbortSignal | undefined,
    operation: (requestSignal: AbortSignal, deadline: number) => Promise<T>,
  ): Promise<T> {
    const requestTimeoutMs = this.options.requestTimeoutMs ?? 8000
    const deadline = Date.now() + requestTimeoutMs
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(new Error('provider_timeout')), requestTimeoutMs)
    const forwardAbort = () => timeoutController.abort(signal?.reason)
    if (signal?.aborted) forwardAbort(); else signal?.addEventListener('abort', forwardAbort, { once: true })
    try { return await operation(timeoutController.signal, deadline) } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }

  private async requestCompletion(
    endpoint: string,
    requestBody: string,
    signal: AbortSignal,
    deadline: number,
  ): Promise<{ bodyText: string; status: number }> {
    let lastError: ProviderRequestError | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (signal.aborted) throw abortReason(signal)
      try {
        const response = await this.fetchFn(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.apiKey}` },
          body: requestBody,
          signal,
        })
        if (signal.aborted) throw abortReason(signal)
        if (!response.ok) throw upstreamError(response)
        const declaredLength = Number(response.headers.get('content-length') ?? 0)
        if (declaredLength > MAX_UPSTREAM_BODY_BYTES) throw new ProviderRequestError('provider_response_too_large', 502)
        const bodyText = await response.text()
        if (signal.aborted) throw abortReason(signal)
        if (Buffer.byteLength(bodyText, 'utf8') > MAX_UPSTREAM_BODY_BYTES) throw new ProviderRequestError('provider_response_too_large', 502)
        return { bodyText, status: response.status }
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortReason(signal)
        lastError = error instanceof ProviderRequestError ? error : new ProviderRequestError('provider_network_error', 503, true)
        if (!lastError.retryable || attempt === 1) throw lastError
        const retryDelayMs = lastError.retryAfterMs ?? 100
        if (Date.now() + retryDelayMs >= deadline) throw lastError
        await abortableDelay(retryDelayMs, signal)
      }
    }
    throw lastError ?? new ProviderRequestError('provider_error', 503)
  }
}
