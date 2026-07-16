import type { IntakeSession, PatientGroup } from '../types/intake'

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `medask-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function classifyPatientGroup(age: number): PatientGroup {
  if (!Number.isFinite(age)) return 'unknown'
  return age >= 18 && age <= 65 ? 'adult_18_65' : 'unsupported_age'
}

export function createIntakeSession(age: number, maxTurns = 7): IntakeSession {
  return {
    sessionId: createSessionId(),
    patientGroup: classifyPatientGroup(age),
    patientAge: age,
    chiefComplaints: [],
    answers: {},
    askedSlotIds: [],
    skippedSlotIds: [],
    notApplicableSlotIds: [],
    currentSlotId: null,
    turnCount: 0,
    maxTurns,
    status: 'idle',
    escalationReason: null,
    traceEvents: [],
    llmTraceEvents: [],
  }
}
