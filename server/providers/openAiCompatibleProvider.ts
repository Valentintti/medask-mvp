import { questionRewriteJsonSchema, slotExtractionJsonSchema } from '../../shared/llm/contracts'
import type { QuestionRewriteRequest, SlotExtractionRequest } from '../../src/llm/types'
import { buildQuestionRewritePrompt, QUESTION_REWRITE_SYSTEM_PROMPT } from '../prompts/questionRewritePrompt'
import { buildSlotExtractionPrompt, SLOT_EXTRACTION_SYSTEM_PROMPT } from '../prompts/slotExtractionPrompt'
import type { ProviderUsage, ServerLlmProvider, ServerProviderResult } from '../types'

const MAX_UPSTREAM_BODY_BYTES = 65_536
const MAX_OUTPUT_TOKENS = 600
type FetchLike = typeof fetch
type JsonSchema = Record<string, unknown>

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
function usageFrom(value: unknown): ProviderUsage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { inputTokens: null, outputTokens: null, totalTokens: null }
  const record = value as Record<string, unknown>
  const number = (item: unknown): number | null => typeof item === 'number' && Number.isFinite(item) ? item : null
  return { inputTokens: number(record.prompt_tokens), outputTokens: number(record.completion_tokens), totalTokens: number(record.total_tokens) }
}
function extractContent(bodyText: string): { content: string; usage: ProviderUsage } {
  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>
    const choices = body.choices
    if (!Array.isArray(choices) || choices.length !== 1) throw new Error('choices')
    const first = choices[0]
    if (typeof first !== 'object' || first === null) throw new Error('choice')
    const message = (first as Record<string, unknown>).message
    if (typeof message !== 'object' || message === null) throw new Error('message')
    const content = (message as Record<string, unknown>).content
    if (typeof content !== 'string' || !content.trim()) throw new Error('content')
    return { content, usage: usageFrom(body.usage) }
  } catch { throw new ProviderRequestError('provider_response_invalid', 502) }
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
  apiKey: string; baseUrl: string; model: string; requestTimeoutMs?: number; fetchFn?: FetchLike
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

export class OpenAiCompatibleProvider implements ServerLlmProvider {
  readonly providerAlias = 'openai-compatible'
  readonly modelAlias = 'configured-model'
  private readonly fetchFn: FetchLike
  constructor(private readonly options: OpenAiCompatibleProviderOptions) { this.fetchFn = options.fetchFn ?? fetch }

  extractSlots(input: SlotExtractionRequest, signal?: AbortSignal): Promise<ServerProviderResult> {
    return this.invoke(SLOT_EXTRACTION_SYSTEM_PROMPT, buildSlotExtractionPrompt(input), slotExtractionJsonSchema as unknown as JsonSchema, 'slot_extraction', signal)
  }
  rewriteQuestion(input: QuestionRewriteRequest, signal?: AbortSignal): Promise<ServerProviderResult> {
    return this.invoke(QUESTION_REWRITE_SYSTEM_PROMPT, buildQuestionRewritePrompt(input), questionRewriteJsonSchema as unknown as JsonSchema, 'question_rewrite', signal)
  }

  private async invoke(systemPrompt: string, userPrompt: string, schema: JsonSchema, schemaName: string, signal?: AbortSignal): Promise<ServerProviderResult> {
    const requestTimeoutMs = this.options.requestTimeoutMs ?? 8000
    const deadline = Date.now() + requestTimeoutMs
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => timeoutController.abort(new Error('provider_timeout')), requestTimeoutMs)
    const forwardAbort = () => timeoutController.abort(signal?.reason)
    signal?.addEventListener('abort', forwardAbort, { once: true })
    const requestSignal = timeoutController.signal
    const requestBody = JSON.stringify({
      model: this.options.model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
      max_tokens: MAX_OUTPUT_TOKENS,
    })
    let lastError: ProviderRequestError | null = null
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (requestSignal.aborted) throw abortReason(requestSignal)
        try {
        const response = await this.fetchFn(completionEndpoint(this.options.baseUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.apiKey}` },
          body: requestBody,
          signal: requestSignal,
        })
        if (requestSignal.aborted) throw abortReason(requestSignal)
        if (!response.ok) {
          throw upstreamError(response)
        }
        const declaredLength = Number(response.headers.get('content-length') ?? 0)
        if (declaredLength > MAX_UPSTREAM_BODY_BYTES) throw new ProviderRequestError('provider_response_too_large', 502)
        const bodyText = await response.text()
        if (requestSignal.aborted) throw abortReason(requestSignal)
        if (Buffer.byteLength(bodyText, 'utf8') > MAX_UPSTREAM_BODY_BYTES) throw new ProviderRequestError('provider_response_too_large', 502)
        const extracted = extractContent(bodyText)
        return {
          rawJson: extracted.content, inputCharacters: systemPrompt.length + userPrompt.length,
          outputCharacters: extracted.content.length, usage: extracted.usage, upstreamStatus: response.status,
        }
        } catch (error) {
          if (requestSignal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw abortReason(requestSignal)
          lastError = error instanceof ProviderRequestError ? error : new ProviderRequestError('provider_network_error', 503, true)
          if (!lastError.retryable || attempt === 1) throw lastError
          const retryDelayMs = lastError.retryAfterMs ?? 100
          if (Date.now() + retryDelayMs >= deadline) throw lastError
          await abortableDelay(retryDelayMs, requestSignal)
        }
      }
      throw lastError ?? new ProviderRequestError('provider_error', 503)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }
}
