import { complaintRules } from '../data/complaintRules'
import type { AnswerValue, ComplaintId } from '../types/intake'
import { hasAffirmedTerm, type TermOccurrence } from './contextMatcher'

function isLocalHeatExpression(text: string, occurrence: TermOccurrence): boolean {
  const context = text.slice(
    Math.max(0, occurrence.index - 4),
    occurrence.index + occurrence.term.length + 3,
  )
  return /(?:胸口|半身|手脚|局部).{0,2}(?:发烧|发热)/u.test(context)
}

export function detectComplaints(text: string): ComplaintId[] {
  const normalized = text.trim()
  if (!normalized) return []

  const matches: ComplaintId[] = []
  if (
    hasAffirmedTerm(normalized, complaintRules.fever.terms, (occurrence) =>
      isLocalHeatExpression(normalized, occurrence),
    )
  ) {
    matches.push('fever')
  }
  if (hasAffirmedTerm(normalized, complaintRules.cough.terms)) {
    matches.push('cough')
  }
  return matches
}

function extractOnset(text: string): string | null {
  const relative = text.match(/(今天|昨天|前天|最近|这两天|这几天)(?:就|已经)?(?:开始|出现)?/u)
  if (relative) return relative[1]

  const duration = text.match(/([一二三四五六七八九十两\d]+(?:小时|天|周|个月|月|年)前)(?:开始|出现)?/u)
  return duration?.[1] ?? null
}

function extractTemperatures(text: string): { current?: number; maximum?: number } {
  const readings = [...text.matchAll(/(3[5-9](?:\.\d)?|4[0-3](?:\.\d)?)\s*(?:℃|度)/gu)]
  if (readings.length === 0) return {}

  const values = readings.map((match) => Number(match[1]))
  const result: { current?: number; maximum?: number } = {}
  if (/最高/u.test(text)) result.maximum = Math.max(...values)
  if (/(?:现在|当前|刚测|体温)/u.test(text)) result.current = values.at(-1)
  if (result.current === undefined && result.maximum === undefined) result.current = values[0]
  return result
}

export function extractInitialAnswers(
  text: string,
  complaints: ComplaintId[],
): Record<string, AnswerValue> {
  const answers: Record<string, AnswerValue> = {}
  const onset = extractOnset(text)
  if (onset) answers.onset = onset

  const temperatures = extractTemperatures(text)
  if (temperatures.current !== undefined) answers.currentTemperature = temperatures.current
  if (temperatures.maximum !== undefined) answers.maxTemperature = temperatures.maximum

  if (complaints.includes('cough')) {
    // 否定表达必须先于“有痰”子串判断，避免“没有痰”被误判。
    if (/(?:干咳|无痰|没有痰)/u.test(text)) answers.coughType = 'dry'
    else if (/(?:有痰|咳痰)/u.test(text)) answers.coughType = 'productive'
  }

  if (complaints.includes('fever') && complaints.includes('cough')) {
    answers.coughAssociated = true
    answers.feverAssociated = true
  }

  return answers
}
