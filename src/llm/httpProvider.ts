import type { LlmProvider, QuestionRewriteRequest, SlotExtractionRequest } from './types'

const MAX_GATEWAY_RESPONSE_CHARACTERS = 32_768
export class GatewayProviderError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'GatewayProviderError' }
}

async function requestJson(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })
  const text = await response.text()
  if (text.length > MAX_GATEWAY_RESPONSE_CHARACTERS) throw new GatewayProviderError('gateway_response_too_large', 502)
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { throw new GatewayProviderError('gateway_invalid_json', 502) }
  if (!response.ok) {
    const code = typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof (parsed as { error?: { code?: unknown } }).error?.code === 'string'
      ? String((parsed as { error: { code: string } }).error.code) : 'gateway_unavailable'
    throw new GatewayProviderError(code, response.status)
  }
  return parsed
}

export class HttpLlmProvider implements LlmProvider {
  readonly name = 'server-gateway'
  extractSlots(input: SlotExtractionRequest, signal?: AbortSignal): Promise<unknown> {
    return requestJson('/api/llm/extract', input, signal)
  }
  rewriteQuestion(input: QuestionRewriteRequest, signal?: AbortSignal): Promise<unknown> {
    return requestJson('/api/llm/rewrite', input, signal)
  }
  async status(signal?: AbortSignal): Promise<{ enabled: boolean }> {
    const response = await fetch('/api/llm/status', { signal, headers: { Accept: 'application/json' } })
    if (!response.ok) return { enabled: false }
    const body = await response.json() as { enabled?: unknown }
    return { enabled: body.enabled === true }
  }
}
