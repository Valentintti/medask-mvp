import { detectComplaintCurrentStatus, detectComplaints, extractInitialAnswers } from '../engines/complaintEngine'
import { checkTextRisk } from '../engines/riskEngine'
import { getSessionSlots } from '../engines/slotEngine'
import { createSummary } from '../engines/summaryEngine'
import { startSession, startSessionWithAdapter } from '../harness/intakeController'
import { createIntakeSession } from '../harness/sessionState'
import { MockLlmProvider } from '../llm/mockProvider'
import { SlotExtractionAdapter } from '../llm/slotExtractionAdapter'
import type { ComplaintCurrentStatus, ComplaintId } from '../types/intake'
import { v2ComplaintCaseCounts, v2ComplaintCases, type V2ComplaintEvalCase } from './v2ComplaintCases'

export interface FractionMetric {
  numerator: number
  denominator: number
  rate: number
}

export interface V2ComplaintEvaluationReport {
  disclaimer: string
  structure: {
    totalCases: number
    targetExecutableCases: number
    designOnlyCases: number
    perComplaint: typeof v2ComplaintCaseCounts
  }
  complaintRecognitionAccuracy: FractionMetric
  currentnessRecognitionAccuracy: FractionMetric
  riskPreemptionRate: FractionMetric
  negationFalseTriggers: number
  historicalMiswrites: number
  resolvedWrittenAsCurrent: number
  sharedSlotDuplicates: number
  summaryFabrications: number
  passed: boolean
  failures: string[]
}

const TARGET_COMPLAINTS = new Set<ComplaintId>(['headache', 'dizziness'])
const FOLLOW_UP_ONLY_CATEGORIES = new Set(['slot_conflict', 'ambiguous'])

function fraction(numerator: number, denominator: number): FractionMetric {
  return {
    numerator,
    denominator,
    rate: denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4)),
  }
}

function expectedCurrentStatus(item: V2ComplaintEvalCase): ComplaintCurrentStatus {
  if (item.expected.complaintStatus === 'asserted') return 'current'
  if (item.expected.complaintStatus === 'resolved') return 'resolved'
  return 'unknown'
}

function valuesInSummaryAreGrounded(item: V2ComplaintEvalCase): boolean {
  const result = startSession({ age: item.age ?? 30, initialText: item.userText })
  const summary = createSummary(result.session)
  const allowed = new Set<unknown>([
    ...Object.values(result.session.answers),
    result.session.initialNarrative,
    'resolved',
  ])
  const entries = [
    ...summary.onset,
    ...summary.currentSymptoms,
    ...summary.resolvedSymptoms,
    ...summary.associatedSymptoms,
    ...summary.measuresTaken,
  ]
  return entries.every((entry) => allowed.has(entry.value))
}

export async function evaluateV2ComplaintCases(): Promise<V2ComplaintEvaluationReport> {
  const targetCases = v2ComplaintCases.filter(
    (item): item is V2ComplaintEvalCase & { complaint: ComplaintId } => TARGET_COMPLAINTS.has(item.complaint as ComplaintId),
  )
  const failures: string[] = []

  let recognitionCorrect = 0
  let recognitionTotal = 0
  let currentnessCorrect = 0
  let currentnessTotal = 0
  let riskPreempted = 0
  let riskTotal = 0
  let negationFalseTriggers = 0
  let historicalMiswrites = 0
  let resolvedWrittenAsCurrent = 0
  let sharedSlotDuplicates = 0
  let summaryFabrications = 0

  for (const item of targetCases) {
    const isFollowUpOnly = FOLLOW_UP_ONLY_CATEGORIES.has(item.category)
    const detected = detectComplaints(item.userText)

    if (!isFollowUpOnly) {
      const expectedDetected = item.expected.complaintStatus === 'asserted' || item.expected.complaintStatus === 'resolved'
      const actualDetected = detected.includes(item.complaint)
      recognitionTotal += 1
      if (actualDetected === expectedDetected) recognitionCorrect += 1
      else failures.push(`${item.id}: complaint recognition expected ${expectedDetected}, got ${actualDetected}`)

      currentnessTotal += 1
      const actualStatus = detectComplaintCurrentStatus(item.userText, item.complaint)
      const expectedStatus = expectedCurrentStatus(item)
      if (actualStatus === expectedStatus) currentnessCorrect += 1
      else failures.push(`${item.id}: currentness expected ${expectedStatus}, got ${actualStatus}`)
    }

    if (item.category === 'risk_expression') {
      riskTotal += 1
      const provider = new MockLlmProvider()
      const result = await startSessionWithAdapter(
        { age: item.age ?? 30, initialText: item.userText },
        new SlotExtractionAdapter(provider),
      )
      if (result.session.status === 'escalated' && provider.extractionCallCount === 0) riskPreempted += 1
      else failures.push(`${item.id}: risk was not terminally preempted before provider`)
    }

    if (item.category === 'negated') {
      if (detected.includes(item.complaint) || checkTextRisk(item.userText).matched) negationFalseTriggers += 1
    }

    if (item.category === 'historical') {
      const answers = extractInitialAnswers(item.userText, [item.complaint])
      if (Object.keys(answers).length > 0) historicalMiswrites += 1
    }

    if (item.category === 'resolved') {
      const result = startSession({ age: item.age ?? 30, initialText: item.userText })
      const summary = createSummary(result.session)
      if (
        detectComplaintCurrentStatus(item.userText, item.complaint) === 'current' ||
        summary.currentSymptoms.some((entry) => entry.value === item.userText)
      ) resolvedWrittenAsCurrent += 1
    }

    if (item.category === 'multi_complaint') {
      const supported = item.expected.matchedComplaints.filter(
        (complaint): complaint is ComplaintId => TARGET_COMPLAINTS.has(complaint as ComplaintId) || complaint === 'fever' || complaint === 'cough',
      )
      const session = createIntakeSession(item.age ?? 30)
      session.chiefComplaints = supported
      const ids = getSessionSlots(session).map((slot) => slot.id)
      sharedSlotDuplicates += Math.max(0, ids.filter((id) => id === 'onset').length - 1)
      sharedSlotDuplicates += Math.max(0, ids.filter((id) => id === 'medicationHistory').length - 1)
    }

    if (!valuesInSummaryAreGrounded(item)) summaryFabrications += 1
  }

  const complaintRecognitionAccuracy = fraction(recognitionCorrect, recognitionTotal)
  const currentnessRecognitionAccuracy = fraction(currentnessCorrect, currentnessTotal)
  const riskPreemptionRate = fraction(riskPreempted, riskTotal)
  const passed =
    v2ComplaintCases.length === 132 &&
    targetCases.length === 66 &&
    complaintRecognitionAccuracy.rate >= 0.9 &&
    currentnessRecognitionAccuracy.rate >= 0.9 &&
    riskPreemptionRate.rate === 1 &&
    negationFalseTriggers === 0 &&
    historicalMiswrites === 0 &&
    resolvedWrittenAsCurrent === 0 &&
    sharedSlotDuplicates === 0 &&
    summaryFabrications === 0

  return {
    disclaimer: '全部结果均为人工合成工程评测指标，不代表临床准确率、诊断能力或医疗安全性。',
    structure: {
      totalCases: v2ComplaintCases.length,
      targetExecutableCases: targetCases.length,
      designOnlyCases: v2ComplaintCases.length - targetCases.length,
      perComplaint: v2ComplaintCaseCounts,
    },
    complaintRecognitionAccuracy,
    currentnessRecognitionAccuracy,
    riskPreemptionRate,
    negationFalseTriggers,
    historicalMiswrites,
    resolvedWrittenAsCurrent,
    sharedSlotDuplicates,
    summaryFabrications,
    passed,
    failures,
  }
}
