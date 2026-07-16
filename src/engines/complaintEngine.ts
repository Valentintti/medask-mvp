import { complaintRules } from '../data/complaintRules'
import type { AnswerValue, ComplaintCurrentStatus, ComplaintId } from '../types/intake'
import { findTermOccurrences, hasAffirmedTerm, type TermOccurrence } from './contextMatcher'

const RECENT_TIME_PATTERN = /(?:今天|昨天|前天|最近|这两天|这几天)/u
const DISTANT_HISTORY_PATTERN = /(?:去年|前年|多年前|小时候|童年|小时侯)/u
const FEVER_EVENT_PATTERN = /(?:发烧|发热|高烧|低烧|烧到|体温(?:升高|高)|3[5-9](?:\.\d)?\s*(?:℃|度)|4[0-3](?:\.\d)?\s*(?:℃|度))/u
const FEVER_RESOLVED_PATTERN = /(?:退烧|退热|烧退了|体温(?:已经|已)?恢复正常|现在(?:已经)?好了)/u
const COMPLAINT_ORDER: ComplaintId[] = ['fever', 'cough', 'headache', 'dizziness']
const INVALID_TEMPLATE_PATTERN = /(?:患者(?:姓名|年龄)\s*[:：]|主诉\s*[:：]|问题描述问题描述|(?:复制|填写).{0,12}模板)/u

export function isRecentResolvedFever(text: string): boolean {
  const normalized = text.trim()
  if (!normalized || DISTANT_HISTORY_PATTERN.test(normalized)) return false
  return RECENT_TIME_PATTERN.test(normalized) && FEVER_EVENT_PATTERN.test(normalized) && FEVER_RESOLVED_PATTERN.test(normalized)
}

function isLocalHeatExpression(text: string, occurrence: TermOccurrence): boolean {
  const context = text.slice(
    Math.max(0, occurrence.index - 4),
    occurrence.index + occurrence.term.length + 3,
  )
  return /(?:胸口|半身|手脚|局部).{0,2}(?:发烧|发热)/u.test(context)
}

function isDizzinessLookalike(text: string, occurrence: TermOccurrence): boolean {
  const context = text.slice(
    Math.max(0, occurrence.index - 8),
    occurrence.index + occurrence.term.length + 8,
  )
  return /(?:喝醉|喝酒|醉酒).{0,6}(?:站不稳|发晕)|(?:晕车|晕船)/u.test(context)
}

function escapedTerms(complaint: ComplaintId): string {
  return complaintRules[complaint].terms
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('|')
}

function currentOccurrences(text: string, complaint: ComplaintId): TermOccurrence[] {
  const occurrences = findTermOccurrences(text, complaintRules[complaint].terms)
  return occurrences.filter((occurrence) => {
    if (occurrence.contextStatus !== 'asserted') return false
    if (complaint === 'fever' && isLocalHeatExpression(text, occurrence)) return false
    if (complaint === 'dizziness' && isDizzinessLookalike(text, occurrence)) return false
    return true
  })
}

function isRecentResolvedComplaint(text: string, complaint: 'headache' | 'dizziness'): boolean {
  if (!text.trim() || DISTANT_HISTORY_PATTERN.test(text)) return false
  const occurrenceResolved = findTermOccurrences(text, complaintRules[complaint].terms)
    .some((occurrence) => occurrence.contextStatus === 'resolved')
  const resolvedAfterComplaint = new RegExp(
    `(?:${escapedTerms(complaint)})[\\s\\S]{0,28}(?:(?<!没)(?<!未)(?<!没有)(?:好了|消失|缓解|恢复正常)|不疼了|不晕了)`,
    'u',
  ).test(text)
  return occurrenceResolved || resolvedAfterComplaint
}

function hasRecurrenceAfterResolution(text: string, complaint: 'headache' | 'dizziness'): boolean {
  return new RegExp(
    `(?:好了|消失|缓解|恢复正常|不疼了|不晕了)[\\s\\S]{0,18}(?:又|再次|重新|现在又)[\\s\\S]{0,8}(?:${escapedTerms(complaint)})`,
    'u',
  ).test(text)
}

export function detectComplaintCurrentStatus(
  text: string,
  complaint: ComplaintId,
): ComplaintCurrentStatus {
  if (INVALID_TEMPLATE_PATTERN.test(text)) return 'unknown'
  if (complaint === 'fever') return detectFeverCurrentStatus(text)
  if (
    (complaint === 'headache' || complaint === 'dizziness') &&
    isRecentResolvedComplaint(text, complaint) &&
    !hasRecurrenceAfterResolution(text, complaint)
  ) return 'resolved'
  if (currentOccurrences(text, complaint).length > 0) return 'current'
  return 'unknown'
}

export function detectComplaints(text: string): ComplaintId[] {
  const normalized = text.trim()
  if (!normalized || INVALID_TEMPLATE_PATTERN.test(normalized)) return []

  return COMPLAINT_ORDER.filter((complaint) => {
    if (complaint === 'fever') {
      return currentOccurrences(normalized, complaint).length > 0 || isRecentResolvedFever(normalized)
    }
    if (currentOccurrences(normalized, complaint).length > 0) return true
    return (complaint === 'headache' || complaint === 'dizziness') &&
      isRecentResolvedComplaint(normalized, complaint)
  })
}

export function detectFeverCurrentStatus(text: string): 'current' | 'resolved' | 'unknown' {
  if (isRecentResolvedFever(text)) return 'resolved'
  return hasAffirmedTerm(text, complaintRules.fever.terms, (occurrence) =>
    isLocalHeatExpression(text, occurrence),
  ) ? 'current' : 'unknown'
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

function extractHeadacheOnsetSpeed(text: string): 'sudden' | 'gradual' | null {
  if (/(?:突然|一下子|猛然)(?:开始|出现|发生)?[^，。！？；,.!?;]{0,8}(?:头痛|头疼|脑袋疼)/u.test(text) ||
    /(?:头痛|头疼|脑袋疼)[^，。！？；,.!?;]{0,8}(?:突然出现|突然开始)/u.test(text)) return 'sudden'
  if (/(?:慢慢|逐渐|渐渐)(?:开始|出现|变得)?[^，。！？；,.!?;]{0,8}(?:头痛|头疼|脑袋疼)/u.test(text) ||
    /(?:头痛|头疼|脑袋疼)[^，。！？；,.!?;]{0,8}(?:慢慢|逐渐|渐渐)/u.test(text)) return 'gradual'
  return null
}

function extractHeadacheLocation(text: string): string | null {
  const locations: Array<[RegExp, string]> = [
    [/(?:前额|额头)(?:部位)?(?:疼|痛)/u, 'forehead'],
    [/(?:太阳穴)[^，。！？；,.!?;]{0,6}(?:疼|痛)/u, 'temple'],
    [/(?:后脑勺|后头)(?:疼|痛)/u, 'occipital'],
    [/(?:左边|右边|左侧|右侧|半边)(?:的)?(?:头|脑袋)(?:疼|痛)/u, 'one_side'],
    [/(?:整个头|全头|满头)(?:都)?(?:疼|痛)/u, 'whole_head'],
  ]
  return locations.find(([pattern]) => pattern.test(text))?.[1] ?? null
}

function extractPattern(text: string, complaint: 'headache' | 'dizziness'): 'continuous' | 'intermittent' | 'recurrent' | null {
  const hasCurrentTerm = currentOccurrences(text, complaint).length > 0
  if (!hasCurrentTerm) return null
  if (/(?:反复|一再|经常又|时不时又)/u.test(text)) return 'recurrent'
  if (/(?:一阵一阵|一阵阵|间歇|时有时无)/u.test(text)) return 'intermittent'
  if (/(?:一直|持续|不停)/u.test(text)) return 'continuous'
  return null
}

function extractDizzinessExperience(text: string): 'spinning' | 'floating' | 'unsteady' | null {
  if (/(?:天旋地转|房间(?:在)?转|周围(?:在)?转)/u.test(text)) return 'spinning'
  if (/(?:晕乎乎|发飘|头重脚轻)/u.test(text)) return 'floating'
  if (/(?:站不稳|走路发飘)/u.test(text) && !/(?:喝醉|喝酒|醉酒)/u.test(text)) return 'unsteady'
  return null
}

function extractDizzinessTrigger(text: string): 'standing_up' | 'turning_head' | 'activity' | null {
  if (/(?:站起来|起身|起床)(?:时|后|就|会)?[^，。！？；,.!?;]{0,8}(?:头晕|发晕|晕乎乎)/u.test(text)) return 'standing_up'
  if (/(?:转头|扭头)(?:时|后|就|会)?[^，。！？；,.!?;]{0,8}(?:头晕|发晕|天旋地转)/u.test(text)) return 'turning_head'
  if (/(?:活动|走路|运动)(?:时|后|就|会)?[^，。！？；,.!?;]{0,8}(?:头晕|发晕)/u.test(text)) return 'activity'
  return null
}

export function extractInitialAnswers(
  text: string,
  complaints: ComplaintId[],
): Record<string, AnswerValue> {
  const answers: Record<string, AnswerValue> = {}
  const hasCurrentOrResolvedComplaint = complaints.some(
    (complaint) => detectComplaintCurrentStatus(text, complaint) !== 'unknown',
  )
  const onset = hasCurrentOrResolvedComplaint ? extractOnset(text) : null
  if (onset) answers.onset = onset

  const temperatures = extractTemperatures(text)
  if (temperatures.current !== undefined) answers.currentTemperature = temperatures.current
  if (temperatures.maximum !== undefined) answers.maxTemperature = temperatures.maximum

  if (complaints.includes('cough')) {
    const coughType = extractCoughType(text)
    if (coughType) answers.coughType = coughType
  }

  if (complaints.includes('headache') && detectComplaintCurrentStatus(text, 'headache') === 'current') {
    const onsetSpeed = extractHeadacheOnsetSpeed(text)
    if (onsetSpeed) answers.headacheOnsetSpeed = onsetSpeed
    const location = extractHeadacheLocation(text)
    if (location) answers.headacheLocation = location
    const pattern = extractPattern(text, 'headache')
    if (pattern) answers.headachePattern = pattern
  }

  if (complaints.includes('dizziness') && detectComplaintCurrentStatus(text, 'dizziness') === 'current') {
    const experience = extractDizzinessExperience(text)
    if (experience) answers.dizzinessExperience = experience
    const pattern = extractPattern(text, 'dizziness')
    if (pattern) answers.dizzinessPattern = pattern
    const trigger = extractDizzinessTrigger(text)
    if (trigger) answers.dizzinessTrigger = trigger
  }

  if (complaints.includes('fever') && complaints.includes('cough')) {
    answers.coughAssociated = true
    answers.feverAssociated = true
  }

  return answers
}
