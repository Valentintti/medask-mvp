import { parseQuestionRewriteResponse, parseSlotExtractionResponse } from '../../src/llm/schema'
import type { QuestionRewriteResponse, SlotExtractionResponse } from '../../src/llm/types'
import { assertPolicySafe } from '../../src/harness/policyGuard'

export const MAX_MODEL_JSON_BYTES = 16_384
export class ResponseValidationError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ResponseValidationError' }
}
function strictJsonObject(raw: string): unknown {
  if (Buffer.byteLength(raw, 'utf8') > MAX_MODEL_JSON_BYTES) throw new ResponseValidationError('response_too_large')
  const text = raw.trim()
  if (!text.startsWith('{') || !text.endsWith('}') || text.includes('```')) throw new ResponseValidationError('response_not_strict_json')
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not_object')
    return parsed
  } catch { throw new ResponseValidationError('response_invalid_json') }
}
export function validateExtractionProviderResponse(raw: string, allowedSlotIds: readonly string[], userText?: string): SlotExtractionResponse {
  const parsed = parseSlotExtractionResponse(strictJsonObject(raw), allowedSlotIds)
  if (!parsed.valid || !parsed.value) throw new ResponseValidationError(parsed.reason ?? 'response_schema_invalid')
  if (parsed.value.candidates.some((candidate) => !allowedSlotIds.includes(candidate.slotId))) throw new ResponseValidationError('response_slot_not_allowed')
  if (userText && parsed.value.candidates.some((candidate) => !userText.includes(candidate.evidence))) throw new ResponseValidationError('evidence_hallucinated')
  return parsed.value
}
export function validateRewriteProviderResponse(raw: string): QuestionRewriteResponse {
  const parsed = parseQuestionRewriteResponse(strictJsonObject(raw))
  if (!parsed.valid || !parsed.value) throw new ResponseValidationError(parsed.reason ?? 'response_schema_invalid')
  try { assertPolicySafe(parsed.value.rewrittenQuestion) } catch { throw new ResponseValidationError('rewrite_policy_violation') }
  return parsed.value
}
