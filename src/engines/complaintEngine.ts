import { complaintRules } from '../data/complaintRules'
import type { AnswerValue, ComplaintId } from '../types/intake'
import { findTermOccurrences, hasAffirmedTerm, type TermOccurrence } from './contextMatcher'

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

  const result: { current?: number; maximum?: number } = {}
  const clauseBoundary = /[，。！？；,.!?;]/u

  for (const reading of readings) {
    const index = reading.index ?? 0
    const value = Number(reading[1])
    const before = text.slice(Math.max(0, index - 24), index)
    const prefix = before.split(clauseBoundary).at(-1) ?? ''
    const after = text.slice(index + reading[0].length, index + reading[0].length + 28)
    const suffix = after.split(clauseBoundary)[0] ?? ''
    const clause = `${prefix}${reading[0]}${suffix}`
    const followingContext = text.slice(index + reading[0].length, index + reading[0].length + 36)
    const isMaximum = /(?:最高|峰值|最高烧到|最多烧到)[^，。！？；,.!?;]{0,8}$/u.test(prefix)
    const isCurrent = /(?:现在|当前|目前|刚测|刚刚测)[^，。！？；,.!?;]{0,8}$/u.test(prefix)
    const isHistorical = /(?:昨天|前天|昨晚|之前|以前|当时|前几天|上周|去年)[^，。！？；,.!?;]{0,10}$/u.test(prefix)
    const isHypothetical = /(?:如果|假如|万一|会不会|可能会)[^，。！？；,.!?;]{0,12}$/u.test(prefix)
    const isNegatedReading = /(?:不到|未到|没有达到|不是)[^，。！？；,.!?;]{0,8}$/u.test(prefix)
    const isResolved = /(?:退烧|退热|烧退|已经不烧|不再发热|体温(?:已|已经)?恢复正常)/u.test(clause) ||
      /^(?:[^，。！？；,.!?;]{0,12}[，,])?[^。！？；.!?;]{0,8}(?:现在|目前|已经)[^。！？；.!?;]{0,8}(?:退烧|退热|烧退|不烧|恢复正常)/u.test(followingContext)

    if (isMaximum) {
      result.maximum = result.maximum === undefined ? value : Math.max(result.maximum, value)
      continue
    }
    if (isResolved || isHistorical || isHypothetical || isNegatedReading) continue
    if (isCurrent || (!isMaximum && !isHistorical)) result.current = value
  }
  return result
}

function extractCoughType(text: string): 'dry' | 'productive' | null {
  const noSputumOccurrences = findTermOccurrences(text, ['没有痰', '无痰', '不咳痰'])
  const noSputumRanges = noSputumOccurrences.map((occurrence) => ({
    start: occurrence.index,
    end: occurrence.index + occurrence.term.length,
  }))
  const overlapsNoSputum = (occurrence: TermOccurrence) =>
    noSputumRanges.some((range) =>
      occurrence.index < range.end && occurrence.index + occurrence.term.length > range.start,
    )

  const candidates: Array<{ index: number; type: 'dry' | 'productive' }> = []
  for (const occurrence of findTermOccurrences(text, ['干咳'])) {
    if (occurrence.contextStatus === 'asserted') candidates.push({ index: occurrence.index, type: 'dry' })
  }
  for (const occurrence of noSputumOccurrences) {
    if (occurrence.contextStatus === 'asserted') candidates.push({ index: occurrence.index, type: 'dry' })
  }
  for (const occurrence of findTermOccurrences(text, ['有痰', '咳痰'])) {
    if (occurrence.contextStatus === 'asserted' && !overlapsNoSputum(occurrence)) {
      candidates.push({ index: occurrence.index, type: 'productive' })
    }
  }

  candidates.sort((left, right) => left.index - right.index)
  return candidates.at(-1)?.type ?? null
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
    const coughType = extractCoughType(text)
    if (coughType) answers.coughType = coughType
  }

  if (complaints.includes('fever') && complaints.includes('cough')) {
    answers.coughAssociated = true
    answers.feverAssociated = true
  }

  return answers
}
