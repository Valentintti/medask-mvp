import { complaintDisplayNames } from '../data/complaintRules'
import { getSessionSlots } from './slotEngine'
import { assertPolicySafe, POLICY_DISCLAIMER } from '../harness/policyGuard'
import type { AnswerValue, IntakeSession, IntakeSummary } from '../types/intake'

function toEntries(
  session: IntakeSession,
  section: 'onset' | 'current' | 'associated' | 'measures',
): Array<{ label: string; value: AnswerValue }> {
  return getSessionSlots(session)
    .filter((slot) => slot.summarySection === section && session.answers[slot.id] !== undefined)
    .map((slot) => ({ label: slot.label, value: session.answers[slot.id] }))
}

export function createSummary(session: IntakeSession): IntakeSummary {
  const slots = getSessionSlots(session)
  const missingInformation = slots
    .filter(
      (slot) =>
        session.answers[slot.id] === undefined &&
        !session.skippedSlotIds.includes(slot.id) &&
        (!slot.showWhen || session.answers[slot.showWhen.slotId] === slot.showWhen.equals),
    )
    .map((slot) => slot.label)

  const summary: IntakeSummary = {
    patientType:
      session.patientGroup === 'adult_18_65' && session.patientAge !== undefined
        ? `18—65岁成人（${session.patientAge}岁）`
        : '不在本演示支持范围',
    chiefComplaints: session.chiefComplaints.map((id) => complaintDisplayNames[id]),
    onset: toEntries(session, 'onset'),
    currentSymptoms: toEntries(session, 'current'),
    associatedSymptoms: toEntries(session, 'associated'),
    measuresTaken: toEntries(session, 'measures'),
    missingInformation,
    escalated: session.status === 'escalated',
    escalationReason: session.escalationReason,
    disclaimer: POLICY_DISCLAIMER,
  }

  assertPolicySafe(JSON.stringify(summary))
  return summary
}
