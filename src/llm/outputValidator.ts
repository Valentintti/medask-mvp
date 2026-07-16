import { checkTextRisk } from '../engines/riskEngine'
import { validateSlotAnswer } from '../engines/slotEngine'
import type { AnswerValue, SlotDefinition } from '../types/intake'
import { evaluateCandidateAcceptance } from './acceptancePolicy'
import type {
  CandidateRejection,
  SlotCandidate,
  SlotConflict,
  SlotExtractionResponse,
} from './types'

export interface OutputValidationResult {
  acceptedCandidates: SlotCandidate[]
  rejectedCandidates: CandidateRejection[]
  conflicts: SlotConflict[]
}

export function validateExtractionOutput(input: {
  response: SlotExtractionResponse
  allowedSlots: SlotDefinition[]
  userText: string
  existingAnswers: Record<string, AnswerValue>
  threshold?: number
}): OutputValidationResult {
  const allowed = new Map(input.allowedSlots.map((slot) => [slot.id, slot]))
  const acceptedCandidates: SlotCandidate[] = []
  const rejectedCandidates: CandidateRejection[] = []
  const conflicts: SlotConflict[] = []

  for (const candidate of input.response.candidates) {
    const slot = allowed.get(candidate.slotId)
    if (!slot) {
      rejectedCandidates.push({ slotId: candidate.slotId, reason: 'slot_not_allowed' })
      continue
    }

    const policyReason = evaluateCandidateAcceptance({
      candidate,
      slot,
      userText: input.userText,
      existingValue: input.existingAnswers[candidate.slotId],
      threshold: input.threshold,
    })
    if (policyReason === 'existing_value_conflict') {
      conflicts.push({
        slotId: candidate.slotId,
        existingValue: input.existingAnswers[candidate.slotId],
        proposedValue: candidate.value,
        evidence: candidate.evidence,
      })
      rejectedCandidates.push({ slotId: candidate.slotId, reason: policyReason })
      continue
    }
    if (policyReason) {
      rejectedCandidates.push({ slotId: candidate.slotId, reason: policyReason })
      continue
    }

    if (!validateSlotAnswer(slot, candidate.value).valid) {
      rejectedCandidates.push({ slotId: candidate.slotId, reason: 'value_invalid' })
      continue
    }

    const candidateValueText =
      typeof candidate.value === 'string' || typeof candidate.value === 'number'
        ? String(candidate.value)
        : ''
    if (checkTextRisk(candidate.evidence).matched || checkTextRisk(candidateValueText).matched) {
      rejectedCandidates.push({ slotId: candidate.slotId, reason: 'risk_evidence_detected' })
      continue
    }

    acceptedCandidates.push(candidate)
  }

  return { acceptedCandidates, rejectedCandidates, conflicts }
}
