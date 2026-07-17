import { detectComplaintCurrentStatus, detectComplaints } from '../engines/complaintEngine'
import { checkTextRisk } from '../engines/riskEngine'
import { getSessionSlots } from '../engines/slotEngine'
import { createSummary } from '../engines/summaryEngine'
import { startSession } from '../harness/intakeController'
import { createIntakeSession } from '../harness/sessionState'
import { v2ComplaintCases } from './v2ComplaintCases'

export interface AbdominalEngineeringEvaluation {
  disclaimer: string
  existingSyntheticDesignCases: number
  supplementalSyntheticCases: number
  complaintRecognition: { correct: number; total: number; rate: number }
  currentStatusRecognition: { correct: number; total: number; rate: number }
  adjacentExpressionFalsePositives: number
  nonCurrentWrittenAsCurrent: number
  riskPreemption: { correct: number; total: number; rate: number }
  negatedOrNonCurrentRiskFalseTriggers: number
  unsupportedPopulationRouting: { correct: number; total: number; rate: number }
  sharedSlotDuplicates: number
  summaryFabrications: number
}

const supplementalCases = [
  { text: '只是腹胀，没有腹痛', complaint: false, status: 'unknown' as const },
  { text: '只有恶心和反酸', complaint: false, status: 'unknown' as const },
  { text: '腰疼得厉害', complaint: false, status: 'unknown' as const },
  { text: '胸痛但肚子不疼', complaint: false, status: 'unknown' as const },
  { text: '今天右下腹一阵阵疼', complaint: true, status: 'current' as const },
  { text: '昨天胃疼，现在已经缓解', complaint: true, status: 'resolved' as const },
  { text: '胃还是肚子说不清', complaint: true, status: 'unknown' as const },
  { text: '如果以后腹痛怎么办', complaint: false, status: 'unknown' as const },
]

function expectedComplaint(category: string): boolean {
  return !['negated', 'historical', 'hypothetical', 'invalid_template'].includes(category)
}

function expectedStatus(category: string): 'current' | 'resolved' | 'unknown' {
  if (category === 'resolved') return 'resolved'
  if (['current_affirmed', 'multi_complaint', 'risk_expression', 'unsupported_population', 'slot_conflict'].includes(category)) return 'current'
  return 'unknown'
}

function rate(correct: number, total: number): number {
  return total === 0 ? 0 : Number(((correct / total) * 100).toFixed(1))
}

export function evaluateAbdominalPainExperimental(): AbdominalEngineeringEvaluation {
  const existing = v2ComplaintCases.filter((item) => item.complaint === 'abdominal_pain')
  const recognitionCases = existing.filter((item) => item.category !== 'slot_conflict')
  let complaintCorrect = 0
  let statusCorrect = 0

  for (const item of recognitionCases) {
    const matched = detectComplaints(item.userText).includes('abdominal_pain')
    if (matched === expectedComplaint(item.category)) complaintCorrect += 1
    if (detectComplaintCurrentStatus(item.userText, 'abdominal_pain') === expectedStatus(item.category)) statusCorrect += 1
  }
  for (const item of supplementalCases) {
    const matched = detectComplaints(item.text).includes('abdominal_pain')
    if (matched === item.complaint) complaintCorrect += 1
    if (detectComplaintCurrentStatus(item.text, 'abdominal_pain') === item.status) statusCorrect += 1
  }

  const adjacent = supplementalCases.filter((item) => !item.complaint).slice(0, 4)
  const adjacentFalsePositives = adjacent.filter((item) => detectComplaints(item.text).includes('abdominal_pain')).length
  const nonCurrent = existing.filter((item) => ['negated', 'historical', 'resolved', 'hypothetical'].includes(item.category))
  const nonCurrentWrittenAsCurrent = nonCurrent.filter(
    (item) => detectComplaintCurrentStatus(item.userText, 'abdominal_pain') === 'current',
  ).length

  const riskCases = existing.filter((item) => item.category === 'risk_expression')
  const riskCorrect = riskCases.filter((item) => checkTextRisk(item.userText).matched).length
  const safeRiskCases = [
    '没有突然剧烈腹痛',
    '以前呕血，现在已经好了',
    '如果以后黑便怎么办',
    '有点肚子疼，已经几天了',
    '想排便但排不出，没有腹胀，也可以排气',
  ]
  const riskFalseTriggers = safeRiskCases.filter((text) => checkTextRisk(text).matched).length

  const unsupportedCases = existing.filter((item) => item.category === 'unsupported_population')
  const unsupportedCorrect = unsupportedCases.filter((item) =>
    startSession({ age: item.age ?? 30, initialText: item.userText }).session.status === 'unsupported',
  ).length

  const multi = createIntakeSession(30)
  multi.chiefComplaints = ['fever', 'abdominal_pain']
  const slotIds = getSessionSlots(multi).map((slot) => slot.id)
  const sharedSlotDuplicates = ['onset', 'medicationHistory'].reduce(
    (count, slotId) => count + Math.max(0, slotIds.filter((id) => id === slotId).length - 1),
    0,
  )

  const summarySession = startSession({ age: 30, initialText: '昨天右下腹疼' }).session
  summarySession.status = 'completed'
  const summaryText = JSON.stringify(createSummary(summarySession))
  const summaryFabrications = /诊断为|建议服用|建议检查|治疗方案|剂量/u.test(summaryText) ? 1 : 0
  const total = recognitionCases.length + supplementalCases.length

  return {
    disclaimer: '合成语言工程评测，不是人工金标、临床准确率或完整分诊验证。',
    existingSyntheticDesignCases: existing.length,
    supplementalSyntheticCases: supplementalCases.length + safeRiskCases.length,
    complaintRecognition: { correct: complaintCorrect, total, rate: rate(complaintCorrect, total) },
    currentStatusRecognition: { correct: statusCorrect, total, rate: rate(statusCorrect, total) },
    adjacentExpressionFalsePositives: adjacentFalsePositives,
    nonCurrentWrittenAsCurrent,
    riskPreemption: { correct: riskCorrect, total: riskCases.length, rate: rate(riskCorrect, riskCases.length) },
    negatedOrNonCurrentRiskFalseTriggers: riskFalseTriggers,
    unsupportedPopulationRouting: { correct: unsupportedCorrect, total: unsupportedCases.length, rate: rate(unsupportedCorrect, unsupportedCases.length) },
    sharedSlotDuplicates,
    summaryFabrications,
  }
}
