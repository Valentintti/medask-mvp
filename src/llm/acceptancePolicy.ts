import { complaintRules } from '../data/complaintRules'
import { riskRules } from '../data/riskRules'
import { findTermOccurrences } from '../engines/contextMatcher'
import type { AnswerValue, SlotDefinition } from '../types/intake'
import type { CandidateRejectionReason, SlotCandidate } from './types'

export const DEFAULT_ACCEPTANCE_THRESHOLD = 0.9

export const MODEL_BLOCKED_RISK_SLOT_IDS = new Set([
  'chestPain',
  'breathingDifficulty',
  'consciousness',
  'consciousnessAltered',
])

const positiveTermsBySlot: Record<string, string[]> = {
  chestPain: riskRules.find((rule) => rule.id.includes('chest_pain'))?.terms ?? ['胸痛'],
  breathingDifficulty:
    riskRules.find((rule) => rule.id.includes('breathing'))?.terms ?? ['呼吸困难'],
  feverAssociated: complaintRules.fever.terms,
  coughAssociated: complaintRules.cough.terms,
  chills: ['畏寒', '寒战', '怕冷'],
  headacheAssociated: ['头痛', '头疼'],
  chestDiscomfort: ['胸闷', '胸口发紧', '胸部不适'],
  nocturnalWorsening: ['夜间加重', '晚上加重'],
}

export function answersEqual(left: AnswerValue, right: AnswerValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function assertedContradictsNegation(candidate: SlotCandidate): boolean {
  const terms = positiveTermsBySlot[candidate.slotId]
  if (!terms) return false
  const occurrences = findTermOccurrences(candidate.evidence, terms)
  return occurrences.length > 0 && occurrences.every((occurrence) => occurrence.negated)
}

export function evaluateCandidateAcceptance(input: {
  candidate: SlotCandidate
  slot: SlotDefinition
  userText: string
  existingValue?: AnswerValue
  threshold?: number
}): CandidateRejectionReason | null {
  const { candidate, slot, userText, existingValue } = input
  const threshold = input.threshold ?? DEFAULT_ACCEPTANCE_THRESHOLD

  if (MODEL_BLOCKED_RISK_SLOT_IDS.has(candidate.slotId)) return 'risk_slot_blocked'
  if (candidate.confidence < threshold) return 'confidence_low'
  if (candidate.status !== 'asserted') return 'status_not_asserted'
  if (!candidate.evidence) return 'evidence_missing'
  if (!userText.includes(candidate.evidence)) return 'evidence_hallucinated'
  if (assertedContradictsNegation(candidate)) return 'negation_conflict'
  if (existingValue !== undefined && !answersEqual(existingValue, candidate.value)) {
    return 'existing_value_conflict'
  }

  if (slot.inputType === 'number' && typeof candidate.value !== 'number') return 'value_invalid'
  if (slot.inputType === 'boolean' && typeof candidate.value !== 'boolean') return 'value_invalid'
  if (slot.inputType === 'text' && typeof candidate.value !== 'string') return 'value_invalid'
  if (slot.inputType === 'singleSelect' && typeof candidate.value !== 'string') {
    return 'value_invalid'
  }
  return null
}
