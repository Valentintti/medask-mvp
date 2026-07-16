import { complaintRules } from '../data/complaintRules'
import { riskRules } from '../data/riskRules'
import { findEvidenceOccurrences, findTermOccurrences, type TermOccurrence } from '../engines/contextMatcher'
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
  if (
    (typeof left === 'number' || typeof left === 'string') &&
    (typeof right === 'number' || typeof right === 'string')
  ) {
    const numericPattern = /^-?(?:\d+\.?\d*|\.\d+)$/u
    const leftText = String(left).trim()
    const rightText = String(right).trim()
    if (numericPattern.test(leftText) && numericPattern.test(rightText)) {
      return Number(leftText) === Number(rightText)
    }
  }
  return JSON.stringify(left) === JSON.stringify(right)
}

function relevantEvidenceContexts(
  userText: string,
  candidate: SlotCandidate,
): TermOccurrence[] {
  const evidenceOccurrences = findEvidenceOccurrences(userText, candidate.evidence)
  const terms = positiveTermsBySlot[candidate.slotId]
  if (!terms) return evidenceOccurrences

  const termOccurrences = findTermOccurrences(userText, terms)
  const relevantTerms = termOccurrences.filter((termOccurrence) =>
    evidenceOccurrences.some((evidenceOccurrence) => {
      const evidenceStart = evidenceOccurrence.index
      const evidenceEnd = evidenceStart + candidate.evidence.length
      const termStart = termOccurrence.index
      const termEnd = termStart + termOccurrence.term.length
      return termStart < evidenceEnd && termEnd > evidenceStart
    }),
  )
  return relevantTerms.length > 0 ? relevantTerms : evidenceOccurrences
}

function contextRejectionReason(
  occurrences: TermOccurrence[],
): CandidateRejectionReason | null {
  if (occurrences.some((occurrence) => occurrence.contextStatus === 'asserted')) return null
  const statuses = new Set(occurrences.map((occurrence) => occurrence.contextStatus))
  if (statuses.size === 1 && statuses.has('negated')) return 'negation_conflict'
  if (statuses.size === 1 && statuses.has('historical')) return 'historical_context'
  if (statuses.size === 1 && statuses.has('resolved')) return 'resolved_context'
  if (statuses.size === 1 && statuses.has('hypothetical')) return 'hypothetical_context'
  // 混合的非当前语境也不能自动写入；选择最保守且可解释的原因。
  if (statuses.has('resolved')) return 'resolved_context'
  if (statuses.has('historical')) return 'historical_context'
  if (statuses.has('hypothetical')) return 'hypothetical_context'
  return 'negation_conflict'
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
  if (!candidate.evidence) return 'evidence_missing'
  if (!userText.includes(candidate.evidence)) return 'evidence_hallucinated'
  if (candidate.status === 'negated') return 'candidate_negated'
  if (candidate.status === 'uncertain') return 'candidate_uncertain'
  if (candidate.status === 'historical') return 'historical_context'
  if (candidate.status === 'resolved') return 'resolved_context'
  if (candidate.status === 'hypothetical') return 'hypothetical_context'
  if (candidate.status !== 'asserted') return 'status_not_asserted'

  const contextReason = contextRejectionReason(relevantEvidenceContexts(userText, candidate))
  if (contextReason) return contextReason

  if (existingValue !== undefined) {
    return answersEqual(existingValue, candidate.value)
      ? 'already_answered_same_value'
      : 'existing_value_conflict'
  }

  if (slot.inputType === 'number' && typeof candidate.value !== 'number') return 'value_invalid'
  if (slot.inputType === 'boolean' && typeof candidate.value !== 'boolean') return 'value_invalid'
  if (slot.inputType === 'text' && typeof candidate.value !== 'string') return 'value_invalid'
  if (slot.inputType === 'singleSelect' && typeof candidate.value !== 'string') {
    return 'value_invalid'
  }
  return null
}
