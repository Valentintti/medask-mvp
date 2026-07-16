import { checkTextRisk } from '../../engines/riskEngine'
import { getSessionSlots } from '../../engines/slotEngine'
import { createIntakeSession } from '../../harness/sessionState'
import type { AnswerValue } from '../../types/intake'
import { MockLlmProvider } from '../mockProvider'
import { SlotExtractionAdapter } from '../slotExtractionAdapter'
import type { CandidateRejectionReason, ExtractionAdapterResult } from '../types'
import { slotExtractionCases } from './slotExtractionCases'

export interface MetricFraction {
  numerator: number
  denominator: number
  value: number
}

export interface SlotExtractionEvalMetrics {
  caseCount: number
  validExtractionCaseCount: number
  validExtractionSlotPrecision: number
  validExtractionSlotRecall: number
  validExtractionExactMatch: number
  pipelineOutcomeAccuracy: number
  invalidOutputRejectionRate: number
  riskPreemptionRate: number
  lowConfidenceRejectionRate: number
  uncertainClarificationRate: number
  conflictRoutingAccuracy: number
  hallucinatedEvidenceCount: number
  falseRiskOverrideCount: number
  counts: Record<string, MetricFraction>
}

function key(slotId: string, value: AnswerValue): string {
  return `${slotId}:${JSON.stringify(value)}`
}

function fraction(numerator: number, denominator: number): MetricFraction {
  return { numerator, denominator, value: denominator > 0 ? numerator / denominator : 0 }
}

function hasReason(result: ExtractionAdapterResult | null, reason: CandidateRejectionReason): boolean {
  return result?.rejectedCandidates.some((item) => item.reason === reason) ?? false
}

export async function runSlotExtractionEval(): Promise<SlotExtractionEvalMetrics> {
  const responseMap = Object.fromEntries(slotExtractionCases.map((item) => [item.userText, item.rawResponse]))
  const provider = new MockLlmProvider({ responses: responseMap })
  const adapter = new SlotExtractionAdapter(provider)
  let validCases = 0
  let truePositive = 0
  let acceptedTotal = 0
  let expectedTotal = 0
  let exactCount = 0
  let pipelineCorrect = 0
  let invalidRejected = 0
  let invalidCount = 0
  let riskPreempted = 0
  let riskCount = 0
  let lowConfidenceRejected = 0
  let lowConfidenceCount = 0
  let uncertainClarified = 0
  let uncertainCount = 0
  let conflictRouted = 0
  let conflictCount = 0
  let falseRiskOverrideCount = 0
  let hallucinatedEvidenceCount = 0

  for (const item of slotExtractionCases) {
    const expected = new Set(item.expectedAccepted.map((entry) => key(entry.slotId, entry.value)))
    const risk = checkTextRisk(item.userText)
    let result: ExtractionAdapterResult | null = null
    let providerWasCalled = false

    if (risk.matched) {
      if (!item.riskExpected) falseRiskOverrideCount += 1
    } else {
      const session = createIntakeSession(30)
      session.chiefComplaints = item.complaints
      session.answers = { ...(item.existingAnswers ?? {}) }
      const callsBefore = provider.extractionCallCount
      result = await adapter.extract({
        supportedComplaints: item.complaints,
        allowedSlots: getSessionSlots(session),
        currentQuestionSlotId: null,
        userText: item.userText,
        existingAnswers: session.answers,
      })
      providerWasCalled = provider.extractionCallCount > callsBefore
    }

    const acceptedCandidates = result?.acceptedCandidates ?? []
    const accepted = new Set(acceptedCandidates.map((entry) => key(entry.slotId, entry.value)))
    const exact = accepted.size === expected.size && [...accepted].every((entry) => expected.has(entry))

    // 只把存在明确目标槽位的非风险、非非法输出案例放入有效提取分母。
    const validExtractionCase = !item.riskExpected && !item.invalidOutput && expected.size > 0
    if (validExtractionCase) {
      validCases += 1
      expectedTotal += expected.size
      acceptedTotal += accepted.size
      for (const acceptedKey of accepted) if (expected.has(acceptedKey)) truePositive += 1
      if (exact) exactCount += 1
    }

    if (item.riskExpected) {
      riskCount += 1
      if (risk.matched && !providerWasCalled) riskPreempted += 1
    }
    if (item.invalidOutput) {
      invalidCount += 1
      if (accepted.size === 0 && Boolean(result?.fallbackToRules || result?.rejectedCandidates.length)) {
        invalidRejected += 1
      }
    }
    if (item.lowConfidenceExpected) {
      lowConfidenceCount += 1
      if (hasReason(result, 'confidence_low') && accepted.size === 0) lowConfidenceRejected += 1
    }
    if (item.uncertainExpected) {
      uncertainCount += 1
      if (hasReason(result, 'candidate_uncertain') && result?.needsClarification) uncertainClarified += 1
    }
    if (item.conflictExpected) {
      conflictCount += 1
      if (result?.conflicts.length && hasReason(result, 'existing_value_conflict')) conflictRouted += 1
    }

    let pipelineCaseCorrect = false
    if (item.riskExpected) pipelineCaseCorrect = risk.matched && !providerWasCalled
    else if (item.invalidOutput) pipelineCaseCorrect = accepted.size === 0
    else if (item.lowConfidenceExpected) pipelineCaseCorrect = hasReason(result, 'confidence_low')
    else if (item.uncertainExpected) pipelineCaseCorrect = hasReason(result, 'candidate_uncertain')
    else if (item.conflictExpected) pipelineCaseCorrect = Boolean(result?.conflicts.length)
    else pipelineCaseCorrect = exact
    if (pipelineCaseCorrect) pipelineCorrect += 1

    hallucinatedEvidenceCount += acceptedCandidates.filter(
      (entry) => !item.userText.includes(entry.evidence),
    ).length
  }

  const counts = {
    validExtractionSlotPrecision: fraction(truePositive, acceptedTotal),
    validExtractionSlotRecall: fraction(truePositive, expectedTotal),
    validExtractionExactMatch: fraction(exactCount, validCases),
    pipelineOutcomeAccuracy: fraction(pipelineCorrect, slotExtractionCases.length),
    invalidOutputRejectionRate: fraction(invalidRejected, invalidCount),
    riskPreemptionRate: fraction(riskPreempted, riskCount),
    lowConfidenceRejectionRate: fraction(lowConfidenceRejected, lowConfidenceCount),
    uncertainClarificationRate: fraction(uncertainClarified, uncertainCount),
    conflictRoutingAccuracy: fraction(conflictRouted, conflictCount),
  }

  return {
    caseCount: slotExtractionCases.length,
    validExtractionCaseCount: validCases,
    validExtractionSlotPrecision: counts.validExtractionSlotPrecision.value,
    validExtractionSlotRecall: counts.validExtractionSlotRecall.value,
    validExtractionExactMatch: counts.validExtractionExactMatch.value,
    pipelineOutcomeAccuracy: counts.pipelineOutcomeAccuracy.value,
    invalidOutputRejectionRate: counts.invalidOutputRejectionRate.value,
    riskPreemptionRate: counts.riskPreemptionRate.value,
    lowConfidenceRejectionRate: counts.lowConfidenceRejectionRate.value,
    uncertainClarificationRate: counts.uncertainClarificationRate.value,
    conflictRoutingAccuracy: counts.conflictRoutingAccuracy.value,
    hallucinatedEvidenceCount,
    falseRiskOverrideCount,
    counts,
  }
}
