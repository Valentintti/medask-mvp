import { complaintRules } from '../../src/data/complaintRules'
import { MODEL_BLOCKED_RISK_SLOT_IDS } from '../../src/llm/acceptancePolicy'
import type { QuestionRewriteRequest, SlotExtractionRequest } from '../../src/llm/types'
import type { ComplaintId, SlotDefinition } from '../../src/types/intake'
import { RequestValidationError } from '../security/errors'

export const SERVER_COMPLAINT_IDS = new Set<ComplaintId>(['fever', 'cough'])

export function trustedSlotsForComplaints(complaints: readonly ComplaintId[]): Map<string, SlotDefinition> {
  const trusted = new Map<string, SlotDefinition>()
  for (const complaint of complaints) {
    for (const slot of complaintRules[complaint].slots) trusted.set(slot.id, slot)
  }
  return trusted
}

export const SERVER_SUPPORTED_SLOT_IDS = new Set(
  [...SERVER_COMPLAINT_IDS].flatMap((complaint) => complaintRules[complaint].slots.map((slot) => slot.id)),
)

export function enforceTrustedExtractionScope(input: SlotExtractionRequest): SlotExtractionRequest {
  const trusted = trustedSlotsForComplaints(input.supportedComplaints)
  if (input.allowedSlotIds.some((slotId) => !trusted.has(slotId))) {
    throw new RequestValidationError('slot_not_allowed_for_complaint')
  }
  if (input.currentQuestionSlotId && !trusted.has(input.currentQuestionSlotId)) {
    throw new RequestValidationError('current_slot_not_allowed_for_complaint')
  }
  if (input.existingSlotIds.some((slotId) => !trusted.has(slotId))) {
    throw new RequestValidationError('existing_slot_not_allowed_for_complaint')
  }
  const allowedSlotIds = input.allowedSlotIds.filter((slotId) => !MODEL_BLOCKED_RISK_SLOT_IDS.has(slotId))
  return {
    ...input,
    allowedSlotIds,
    existingSlotIds: input.existingSlotIds.filter((slotId) => allowedSlotIds.includes(slotId)),
    currentQuestionSlotId: input.currentQuestionSlotId && allowedSlotIds.includes(input.currentQuestionSlotId)
      ? input.currentQuestionSlotId
      : null,
  }
}

export function enforceTrustedRewriteScope(input: QuestionRewriteRequest): QuestionRewriteRequest {
  const trusted = trustedSlotsForComplaints(input.complaintContext)
  const slot = trusted.get(input.slotId)
  if (!slot) throw new RequestValidationError('slot_not_allowed_for_complaint')
  return {
    schemaVersion: input.schemaVersion,
    slotId: slot.id,
    canonicalQuestion: slot.question,
    complaintContext: [...input.complaintContext],
    required: slot.required,
    inputType: slot.inputType,
    ...(slot.unit ? { unit: slot.unit } : {}),
    locale: input.locale,
  }
}
