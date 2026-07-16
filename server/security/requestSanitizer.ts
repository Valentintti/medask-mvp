import { SHARED_LLM_SCHEMA_VERSION } from '../../shared/llm/contracts'
import type { QuestionRewriteRequest, SlotExtractionRequest } from '../../src/llm/types'
import type { ComplaintId } from '../../src/types/intake'
import { SERVER_COMPLAINT_IDS, SERVER_SUPPORTED_SLOT_IDS } from '../rules/serverSlotRules'
import { RequestValidationError } from './errors'

export { RequestValidationError } from './errors'

export const MAX_REQUEST_BODY_BYTES = 16_384
export const MAX_USER_TEXT_CHARACTERS = 500
export const MAX_ALLOWED_SLOT_IDS = 32

const EXTRACT_KEYS = ['supportedComplaints', 'allowedSlotIds', 'currentQuestionSlotId', 'userText', 'existingSlotIds', 'locale', 'schemaVersion']
const REWRITE_REQUIRED_KEYS = ['schemaVersion', 'slotId', 'canonicalQuestion', 'complaintContext', 'required', 'inputType', 'locale']
const REWRITE_OPTIONAL_KEYS = ['unit']
const INVISIBLE_OR_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/gu

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}
function parseBody(bodyText: string): unknown {
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_REQUEST_BODY_BYTES) throw new RequestValidationError('request_too_large', 413)
  try { return JSON.parse(bodyText) } catch { throw new RequestValidationError('invalid_json') }
}
export function stripUnsafeCharacters(value: string): string { return value.replace(INVISIBLE_OR_CONTROL, '').trim() }
function stringArray(value: unknown, max: number): string[] | null {
  if (!Array.isArray(value) || value.length > max || !value.every((item) => typeof item === 'string')) return null
  const sanitized = value.map((item) => stripUnsafeCharacters(item))
  return sanitized.every(Boolean) ? [...new Set(sanitized)] : null
}
function isComplaintId(value: string): value is ComplaintId {
  return SERVER_COMPLAINT_IDS.has(value as ComplaintId)
}
function complaints(value: unknown): ComplaintId[] | null {
  const items = stringArray(value, 4)
  if (!items || items.length === 0 || !items.every(isComplaintId)) return null
  return items
}
export function sanitizeExtractRequest(bodyText: string): SlotExtractionRequest {
  const raw = parseBody(bodyText)
  if (!record(raw) || !exactKeys(raw, EXTRACT_KEYS)) throw new RequestValidationError('request_fields_invalid')
  const supportedComplaints = complaints(raw.supportedComplaints)
  const allowedSlotIds = stringArray(raw.allowedSlotIds, MAX_ALLOWED_SLOT_IDS)
  const existingSlotIds = stringArray(raw.existingSlotIds, MAX_ALLOWED_SLOT_IDS)
  const userText = typeof raw.userText === 'string' ? stripUnsafeCharacters(raw.userText) : ''
  const currentQuestionSlotId = raw.currentQuestionSlotId === null
    ? null
    : typeof raw.currentQuestionSlotId === 'string' ? stripUnsafeCharacters(raw.currentQuestionSlotId) : ''
  if (!supportedComplaints || !allowedSlotIds || !existingSlotIds) throw new RequestValidationError('request_values_invalid')
  if (!allowedSlotIds.every((slotId) => SERVER_SUPPORTED_SLOT_IDS.has(slotId))) throw new RequestValidationError('slot_not_allowed')
  if (!existingSlotIds.every((slotId) => allowedSlotIds.includes(slotId))) throw new RequestValidationError('existing_slot_not_allowed')
  if (currentQuestionSlotId && !allowedSlotIds.includes(currentQuestionSlotId)) throw new RequestValidationError('current_slot_not_allowed')
  if (!userText) throw new RequestValidationError('empty_user_text')
  if ([...userText].length > MAX_USER_TEXT_CHARACTERS) throw new RequestValidationError('user_text_too_long')
  if (raw.locale !== 'zh-CN' || raw.schemaVersion !== SHARED_LLM_SCHEMA_VERSION) throw new RequestValidationError('request_version_invalid')
  return { supportedComplaints, allowedSlotIds, currentQuestionSlotId, userText, existingSlotIds, locale: 'zh-CN', schemaVersion: SHARED_LLM_SCHEMA_VERSION }
}
export function sanitizeRewriteRequest(bodyText: string): QuestionRewriteRequest {
  const raw = parseBody(bodyText)
  if (!record(raw) || !exactKeys(raw, REWRITE_REQUIRED_KEYS, REWRITE_OPTIONAL_KEYS)) throw new RequestValidationError('request_fields_invalid')
  const complaintContext = complaints(raw.complaintContext)
  const slotId = typeof raw.slotId === 'string' ? stripUnsafeCharacters(raw.slotId) : ''
  const canonicalQuestion = typeof raw.canonicalQuestion === 'string' ? stripUnsafeCharacters(raw.canonicalQuestion) : ''
  const unit = raw.unit === undefined ? undefined : typeof raw.unit === 'string' ? stripUnsafeCharacters(raw.unit) : ''
  if (!complaintContext || !SERVER_SUPPORTED_SLOT_IDS.has(slotId) || !canonicalQuestion || canonicalQuestion.length > 240) throw new RequestValidationError('request_values_invalid')
  if (raw.schemaVersion !== SHARED_LLM_SCHEMA_VERSION || raw.locale !== 'zh-CN') throw new RequestValidationError('request_version_invalid')
  if (typeof raw.required !== 'boolean' || !['text', 'number', 'boolean', 'singleSelect'].includes(String(raw.inputType))) throw new RequestValidationError('request_values_invalid')
  if (unit !== undefined && (!unit || unit.length > 12)) throw new RequestValidationError('request_values_invalid')
  return { schemaVersion: SHARED_LLM_SCHEMA_VERSION, slotId, canonicalQuestion, complaintContext, required: raw.required, inputType: raw.inputType as QuestionRewriteRequest['inputType'], ...(unit ? { unit } : {}), locale: 'zh-CN' }
}
