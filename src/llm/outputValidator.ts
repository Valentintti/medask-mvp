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

function normalizeCandidateValue(candidate: SlotCandidate, slot: SlotDefinition): SlotCandidate {
  if (slot.inputType !== 'number' || typeof candidate.value !== 'string') return candidate
  const text = candidate.value.trim()
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/u.test(text)) return candidate
  const numeric = Number(text)
  return Number.isFinite(numeric) ? { ...candidate, value: numeric } : candidate
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

    const normalizedCandidate = normalizeCandidateValue(candidate, slot)

    const policyReason = evaluateCandidateAcceptance({
      candidate: normalizedCandidate,
      slot,
      userText: input.userText,
      existingValue: input.existingAnswers[normalizedCandidate.slotId],
      threshold: input.threshold,
    })
    if (policyReason === 'existing_value_conflict') {
      conflicts.push({
        slotId: normalizedCandidate.slotId,
        existingValue: input.existingAnswers[normalizedCandidate.slotId],
        proposedValue: normalizedCandidate.value,
        evidence: normalizedCandidate.evidence,
      })
      rejectedCandidates.push({ slotId: candidate.slotId, reason: policyReason })
      continue
    }
    if (policyReason) {
      rejectedCandidates.push({ slotId: candidate.slotId, reason: policyReason })
      continue
    }

    if (!validateSlotAnswer(slot, normalizedCandidate.value).valid) {
      rejectedCandidates.push({ slotId: candidate.slotId, reason: 'value_invalid' })
      continue
    }

    const candidateValueText =
      typeof normalizedCandidate.value === 'string' || typeof normalizedCandidate.value === 'number'
        ? String(normalizedCandidate.value)
        : ''
    if (checkTextRisk(normalizedCandidate.evidence).matched || checkTextRisk(candidateValueText).matched) {
      rejectedCandidates.push({ slotId: candidate.slotId, reason: 'risk_evidence_detected' })
      continue
    }

    acceptedCandidates.push(normalizedCandidate)
  }

  return { acceptedCandidates, rejectedCandidates, conflicts }
}
