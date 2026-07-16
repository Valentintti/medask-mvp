import { ESCALATION_SAFETY_MESSAGE, riskRules } from '../data/riskRules'
import type { AnswerValue, RiskResult } from '../types/intake'
import { findTermOccurrences, hasAffirmedTerm, type TermOccurrence } from './contextMatcher'

const noRisk = (): RiskResult => ({
  matched: false,
  ruleId: 'risk.none',
  reason: null,
  safetyMessage: null,
})

function matchesGroupedRule(
  text: string,
  groups: string[][],
  maxSpan: number,
): boolean {
  const occurrences = groups.map((terms) =>
    findTermOccurrences(text, terms).filter((item) => item.contextStatus === 'asserted'),
  )
  if (occurrences.some((items) => items.length === 0)) return false

  const selected: TermOccurrence[] = []
  const visit = (groupIndex: number): boolean => {
    if (groupIndex === occurrences.length) {
      const start = Math.min(...selected.map((item) => item.index))
      const end = Math.max(...selected.map((item) => item.index + item.term.length))
      if (end - start > maxSpan) return false
      return !/[。！？.!?]/u.test(text.slice(start, end))
    }
    return occurrences[groupIndex].some((item) => {
      selected.push(item)
      const matched = visit(groupIndex + 1)
      selected.pop()
      return matched
    })
  }
  return visit(0)
}

export function checkTextRisk(text: string): RiskResult {
  const normalized = text.trim()
  if (!normalized) return noRisk()

  for (const rule of riskRules) {
    const matched = rule.allTermGroups
      ? matchesGroupedRule(normalized, rule.allTermGroups, rule.maxSpan ?? 80)
      : rule.terms ? hasAffirmedTerm(normalized, rule.terms) : false
    if (matched) {
      return {
        matched: true,
        ruleId: rule.id,
        reason: rule.escalationReason,
        safetyMessage: ESCALATION_SAFETY_MESSAGE,
      }
    }
  }

  return noRisk()
}

export function checkStructuredRisk(slotId: string, value: AnswerValue): RiskResult {
  if (value !== true) return noRisk()

  if (slotId === 'chestPain') {
    return {
      matched: true,
      ruleId: 'risk.chest_pain.structured',
      reason: '用户确认当前存在明确胸痛',
      safetyMessage: ESCALATION_SAFETY_MESSAGE,
    }
  }

  if (slotId === 'breathingDifficulty') {
    return {
      matched: true,
      ruleId: 'risk.breathing.structured',
      reason: '用户确认当前存在明显呼吸困难',
      safetyMessage: ESCALATION_SAFETY_MESSAGE,
    }
  }

  return noRisk()
}
