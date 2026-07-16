import { createHash, randomUUID } from 'node:crypto'
import { checkTextRisk } from '../../src/engines/riskEngine'
import { MODEL_BLOCKED_RISK_SLOT_IDS } from '../../src/llm/acceptancePolicy'
import type { QuestionRewriteRequest, SlotExtractionRequest } from '../../src/llm/types'
import { ProviderRequestError } from '../providers/openAiCompatibleProvider'
import { createAuditLogger } from '../security/auditLogger'
import { DailyTokenBudget, estimateTokensFromCharacters, OncePerOperationGate, SlidingWindowRateLimiter } from '../security/rateLimiter'
import { RequestValidationError, sanitizeExtractRequest, sanitizeRewriteRequest } from '../security/requestSanitizer'
import { ResponseValidationError, validateExtractionProviderResponse, validateRewriteProviderResponse } from '../security/responseValidator'
import type { AuditEvent, RouteRequest, RouteResponse, ServerConfig, ServerLlmProvider, ServerOperation } from '../types'

const MAX_ESTIMATED_INPUT_TOKENS = 2_500
const RESERVED_OUTPUT_TOKENS = 600
type AuditLogger = ReturnType<typeof createAuditLogger>
export interface LlmRouterDependencies { config: ServerConfig; provider: ServerLlmProvider | null; audit?: AuditLogger }

function headers(config: ServerConfig, origin: string | null): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' }
  if (origin && config.allowedOrigins.has(origin)) result['Access-Control-Allow-Origin'] = origin
  return result
}
function response(config: ServerConfig, origin: string | null, status: number, body: unknown): RouteResponse { return { status, headers: headers(config, origin), body } }
function errorResponse(config: ServerConfig, origin: string | null, status: number, code: string): RouteResponse {
  const message = status === 429 ? '请求过于频繁，请使用标准问题继续。' : status === 503 ? '自然语言辅助暂时不可用，请使用标准问题继续。' : '请求无法处理，请使用标准问题继续。'
  return response(config, origin, status, { error: { code, message } })
}
function operationKey(clientKey: string, operation: ServerOperation, body: string): string {
  return createHash('sha256').update(`${clientKey}:${operation}:${body}`).digest('hex')
}
function modelSafeExtractRequest(input: SlotExtractionRequest): SlotExtractionRequest {
  const allowedSlotIds = input.allowedSlotIds.filter((slotId) => !MODEL_BLOCKED_RISK_SLOT_IDS.has(slotId))
  return { ...input, allowedSlotIds, existingSlotIds: input.existingSlotIds.filter((slotId) => allowedSlotIds.includes(slotId)), currentQuestionSlotId: input.currentQuestionSlotId && allowedSlotIds.includes(input.currentQuestionSlotId) ? input.currentQuestionSlotId : null }
}
function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('provider_timeout')), timeoutMs)
  const abort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', abort, { once: true })
  return { signal: controller.signal, clear: () => { clearTimeout(timer); parent?.removeEventListener('abort', abort) } }
}

export function createLlmRouter(dependencies: LlmRouterDependencies) {
  const { config, provider } = dependencies
  const audit = dependencies.audit ?? createAuditLogger()
  const limiter = new SlidingWindowRateLimiter(config.maxRequestsPerMinute)
  const budget = new DailyTokenBudget(config.dailyTokenBudget)
  const onceGate = new OncePerOperationGate()

  return async (request: RouteRequest): Promise<RouteResponse> => {
    if (request.origin && !config.allowedOrigins.has(request.origin)) return errorResponse(config, request.origin, 403, 'origin_not_allowed')
    if (request.method === 'OPTIONS') return { status: 204, headers: { ...headers(config, request.origin), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: null }
    if (request.path === '/api/llm/status' && request.method === 'GET') return response(config, request.origin, 200, { enabled: config.enabled && config.configured })
    if (!['/api/llm/extract', '/api/llm/rewrite'].includes(request.path) || request.method !== 'POST') return errorResponse(config, request.origin, 404, 'not_found')
    if (!config.enabled || !config.configured || !provider) return errorResponse(config, request.origin, 503, 'real_llm_unavailable')

    const operation: ServerOperation = request.path.endsWith('/extract') ? 'extract' : 'rewrite'
    const requestId = randomUUID(); const startedAt = Date.now()
    let inputCharacters = 0; let outputCharacters = 0; let acceptedCount = 0; let rejectedCount = 0
    const log = (status: number, outcome: string, errorCategory: string | null): void => audit({
      requestId, operation, provider: provider.providerAlias, modelAlias: provider.modelAlias,
      timestamp: new Date().toISOString(), latencyMs: Date.now() - startedAt, httpStatus: status, outcome,
      inputCharacters, outputCharacters, acceptedCount, rejectedCount, errorCategory,
    } satisfies AuditEvent)

    try {
      if (!limiter.consume(request.clientKey)) { log(429, 'rejected', 'rate_limited'); return errorResponse(config, request.origin, 429, 'rate_limited') }
      if (!onceGate.consume(operationKey(request.clientKey, operation, request.bodyText))) { log(429, 'rejected', 'duplicate_operation'); return errorResponse(config, request.origin, 429, 'duplicate_operation') }

      const parsed: SlotExtractionRequest | QuestionRewriteRequest = operation === 'extract'
        ? sanitizeExtractRequest(request.bodyText) : sanitizeRewriteRequest(request.bodyText)
      inputCharacters = operation === 'extract' ? (parsed as SlotExtractionRequest).userText.length : (parsed as QuestionRewriteRequest).canonicalQuestion.length
      const estimatedInput = estimateTokensFromCharacters(request.bodyText.length + 4_000)
      if (estimatedInput > MAX_ESTIMATED_INPUT_TOKENS) throw new RequestValidationError('input_token_budget_exceeded', 413)
      if (!budget.reserve(estimatedInput + RESERVED_OUTPUT_TOKENS)) { log(503, 'fallback', 'daily_budget_exceeded'); return errorResponse(config, request.origin, 503, 'daily_budget_exceeded') }

      if (operation === 'extract') {
        const extract = parsed as SlotExtractionRequest
        if (checkTextRisk(extract.userText).matched) { log(409, 'risk_preempted', 'risk_input'); return errorResponse(config, request.origin, 409, 'risk_preempted') }
        const safeRequest = modelSafeExtractRequest(extract)
        const timed = timeoutSignal(request.signal, config.requestTimeoutMs)
        try {
          const result = await provider.extractSlots(safeRequest, timed.signal)
          outputCharacters = result.outputCharacters
          const validated = validateExtractionProviderResponse(result.rawJson, safeRequest.allowedSlotIds, safeRequest.userText)
          acceptedCount = validated.candidates.length
          log(200, 'validated', null)
          return response(config, request.origin, 200, validated)
        } finally { timed.clear() }
      }

      const rewrite = parsed as QuestionRewriteRequest
      if (MODEL_BLOCKED_RISK_SLOT_IDS.has(rewrite.slotId)) { log(400, 'rejected', 'risk_slot_blocked'); return errorResponse(config, request.origin, 400, 'risk_slot_blocked') }
      const timed = timeoutSignal(request.signal, config.requestTimeoutMs)
      try {
        const result = await provider.rewriteQuestion(rewrite, timed.signal)
        outputCharacters = result.outputCharacters
        const validated = validateRewriteProviderResponse(result.rawJson)
        acceptedCount = 1; log(200, 'validated', null)
        return response(config, request.origin, 200, validated)
      } finally { timed.clear() }
    } catch (error) {
      rejectedCount = 1
      const status = error instanceof RequestValidationError ? error.status
        : error instanceof ProviderRequestError ? (error.code === 'provider_aborted' ? 503 : error.status)
          : error instanceof ResponseValidationError ? 502 : 503
      const code = error instanceof RequestValidationError || error instanceof ProviderRequestError || error instanceof ResponseValidationError ? error.code : 'internal_error'
      log(status, 'fallback', code)
      return errorResponse(config, request.origin, status, code)
    }
  }
}
