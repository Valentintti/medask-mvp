import { checkTextRisk } from '../../engines/riskEngine'
import { getSessionSlots } from '../../engines/slotEngine'
import { createIntakeSession } from '../../harness/sessionState'
import { MockLlmProvider } from '../mockProvider'
import { SlotExtractionAdapter } from '../slotExtractionAdapter'
import type { AnswerValue } from '../../types/intake'
import { slotExtractionCases } from './slotExtractionCases'

export interface SlotExtractionEvalMetrics {
  caseCount: number
  slotPrecision: number
  slotRecall: number
  exactMatch: number
  invalidOutputRejectionRate: number
  falseRiskOverrideCount: number
  hallucinatedEvidenceCount: number
}

function key(slotId: string, value: AnswerValue): string {
  return `${slotId}:${JSON.stringify(value)}`
}

export async function runSlotExtractionEval(): Promise<SlotExtractionEvalMetrics> {
  const responseMap = Object.fromEntries(
    slotExtractionCases.map((item) => [item.userText, item.rawResponse]),
  )
  const provider = new MockLlmProvider({ responses: responseMap })
  const adapter = new SlotExtractionAdapter(provider)
  let truePositive = 0
  let acceptedTotal = 0
  let expectedTotal = 0
  let exactCount = 0
  let invalidRejected = 0
  let invalidCount = 0
  let falseRiskOverrideCount = 0
  let hallucinatedEvidenceCount = 0

  for (const item of slotExtractionCases) {
    const expected = new Set(item.expectedAccepted.map((entry) => key(entry.slotId, entry.value)))
    expectedTotal += expected.size
    let acceptedCandidates: Array<{ slotId: string; value: AnswerValue; evidence: string }> = []

    if (checkTextRisk(item.userText).matched) {
      if (!item.riskExpected) falseRiskOverrideCount += 1
    } else {
      const session = createIntakeSession(30)
      session.chiefComplaints = item.complaints
      session.answers = { ...(item.existingAnswers ?? {}) }
      const result = await adapter.extract({
        supportedComplaints: item.complaints,
        allowedSlots: getSessionSlots(session),
        currentQuestionSlotId: null,
        userText: item.userText,
        existingAnswers: session.answers,
      })
      acceptedCandidates = result.acceptedCandidates
    }

    const accepted = new Set(
      acceptedCandidates.map((entry) => key(entry.slotId, entry.value)),
    )
    acceptedTotal += accepted.size
    for (const acceptedKey of accepted) {
      if (expected.has(acceptedKey)) truePositive += 1
    }
    if (
      accepted.size === expected.size &&
      [...accepted].every((acceptedKey) => expected.has(acceptedKey))
    ) {
      exactCount += 1
    }
    hallucinatedEvidenceCount += acceptedCandidates.filter(
      (entry) => !item.userText.includes(entry.evidence),
    ).length
    if (item.invalidOutput) {
      invalidCount += 1
      if (accepted.size === 0) invalidRejected += 1
    }
  }

  return {
    caseCount: slotExtractionCases.length,
    slotPrecision: acceptedTotal ? truePositive / acceptedTotal : 1,
    slotRecall: expectedTotal ? truePositive / expectedTotal : 1,
    exactMatch: exactCount / slotExtractionCases.length,
    invalidOutputRejectionRate: invalidCount ? invalidRejected / invalidCount : 1,
    falseRiskOverrideCount,
    hallucinatedEvidenceCount,
  }
}
