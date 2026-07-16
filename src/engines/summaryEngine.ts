import { complaintDisplayNames } from '../data/complaintRules'
import { formatAnswerValue, formatUserNarrative } from './answerFormatter'
import { getSessionSlots } from './slotEngine'
import { assertSystemNarrativesSafe, POLICY_DISCLAIMER } from '../harness/policyGuard'
import type { IntakeSession, IntakeSummary, SummaryEntry } from '../types/intake'

function toEntries(
  session: IntakeSession,
  section: 'onset' | 'current' | 'associated' | 'measures',
): SummaryEntry[] {
  return getSessionSlots(session)
    .filter((slot) => slot.summarySection === section && session.answers[slot.id] !== undefined)
    .map((slot) => ({
      label: slot.label,
      value: session.answers[slot.id],
      displayValue: formatAnswerValue(slot, session.answers[slot.id]),
      source: 'user' as const,
    }))
}

export function createSummary(session: IntakeSession): IntakeSummary {
  const slots = getSessionSlots(session)
  const unansweredInformation: string[] = []
  const skippedInformation: string[] = []
  const notApplicableInformation: string[] = []

  for (const slot of slots) {
    if (session.answers[slot.id] !== undefined) continue
    if (session.skippedSlotIds.includes(slot.id)) {
      skippedInformation.push(slot.label)
      continue
    }
    const dependencyValue = slot.showWhen
      ? session.answers[slot.showWhen.slotId]
      : undefined
    if (
      session.notApplicableSlotIds.includes(slot.id) ||
      (slot.showWhen && dependencyValue !== undefined && dependencyValue !== slot.showWhen.equals)
    ) {
      notApplicableInformation.push(slot.label)
      continue
    }
    unansweredInformation.push(slot.label)
  }

  const currentSymptoms = toEntries(session, 'current')
  if (session.feverCurrentStatus === 'resolved') {
    currentSymptoms.unshift({
      label: '本次发热状态',
      value: 'resolved',
      displayValue: '本次发热目前已缓解',
      source: 'user',
    })
  }
  if (session.initialNarrative) {
    currentSymptoms.unshift({
      label: '用户首句描述',
      value: session.initialNarrative,
      displayValue: formatUserNarrative(session.initialNarrative),
      source: 'user',
    })
  }

  const summary: IntakeSummary = {
    patientType:
      session.patientGroup === 'adult_18_65' && session.patientAge !== undefined
        ? `18—65岁成人（${session.patientAge}岁）`
        : '不在本演示支持范围',
    chiefComplaints: session.chiefComplaints.map((id) => complaintDisplayNames[id]),
    onset: toEntries(session, 'onset'),
    currentSymptoms,
    associatedSymptoms: toEntries(session, 'associated'),
    measuresTaken: toEntries(session, 'measures'),
    unansweredInformation,
    skippedInformation,
    notApplicableInformation,
    escalated: session.status === 'escalated',
    escalationReason: session.escalationReason,
    disclaimer: POLICY_DISCLAIMER,
  }

  // 用户原文不进入系统输出审核，避免把忠实记录误判为系统诊断或处方。
  assertSystemNarrativesSafe([
    summary.patientType,
    ...summary.chiefComplaints,
    ...slots.map((slot) => slot.label),
    summary.escalationReason ?? '',
    summary.disclaimer,
  ])
  return summary
}
