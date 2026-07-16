import { ESCALATION_SAFETY_MESSAGE, riskRules } from '../data/riskRules'
import type { AnswerValue, RiskResult } from '../types/intake'
import { hasAffirmedTerm } from './contextMatcher'

const noRisk = (): RiskResult => ({
  matched: false,
  ruleId: 'risk.none',
  reason: null,
  safetyMessage: null,
})

export function checkTextRisk(text: string): RiskResult {
  const normalized = text.trim()
  if (!normalized) return noRisk()

  for (const rule of riskRules) {
    if (hasAffirmedTerm(normalized, rule.terms)) {
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
