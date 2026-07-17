import { ESCALATION_SAFETY_MESSAGE, riskRules } from '../data/riskRules'
import type { AnswerValue, RiskResult } from '../types/intake'
import { findTermOccurrences, hasAffirmedTerm, type TermOccurrence } from './contextMatcher'
import { isInvalidOrConcatenatedMedicalText } from './textEligibility'

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
    findTermOccurrences(text, terms).filter((item) => {
      if (item.contextStatus === 'asserted') return true
      // “无法/不能/排不出”本身描述功能缺失，不应被通用“不”字否定逻辑反转；
      // 但“没有无法……”这类外层否定仍然拒绝。
      if (!/(?:无法|不能|排不出)/u.test(item.term)) return false
      const outerPrefix = text.slice(Math.max(0, item.index - 6), item.index)
      return !/(?:没有|并非|否认|未出现|不存在)\s*$/u.test(outerPrefix)
    }),
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

function hasOnlyResolvedRiskOccurrences(text: string, ruleTerms: string[]): boolean {
  const occurrences = findTermOccurrences(text, ruleTerms)
  if (occurrences.length === 0) return false
  return occurrences.every((occurrence) => {
    if (occurrence.contextStatus !== 'asserted') return true
    const tail = text.slice(occurrence.index + occurrence.term.length, occurrence.index + occurrence.term.length + 44)
    const resolutionIndex = tail.search(/(?:现在|目前|后来|随后|已经).{0,8}(?:好了|缓解|消失|没有了|停止|恢复正常)/u)
    if (resolutionIndex < 0) return false
    const afterResolution = tail.slice(resolutionIndex)
    return !/(?:又|再次|重新|复发|仍在|还在).{0,10}(?:腹痛|肚子疼|胃疼|呕血|吐血|便血|黑便|腹胀)/u.test(afterResolution)
  })
}

export function checkTextRisk(text: string): RiskResult {
  const normalized = text.trim()
  if (!normalized || isInvalidOrConcatenatedMedicalText(normalized)) return noRisk()

  for (const rule of riskRules) {
    const ruleTerms = rule.allTermGroups?.flat() ?? rule.terms ?? []
    if (hasOnlyResolvedRiskOccurrences(normalized, ruleTerms)) continue
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
