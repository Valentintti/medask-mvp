import type { LlmTraceEvent } from '../llm/types'

export type ComplaintId = 'fever' | 'cough'

export type SessionStatus =
  | 'idle'
  | 'collecting'
  | 'completed'
  | 'escalated'
  | 'unsupported'
  | 'error'

export type PatientGroup = 'adult_18_65' | 'unsupported_age' | 'unknown'

export type AnswerValue = string | number | boolean | string[]

export type SlotInputType = 'text' | 'number' | 'boolean' | 'singleSelect'

export type TraceEventType =
  | 'session_started'
  | 'risk_checked'
  | 'complaint_matched'
  | 'slot_answered'
  | 'slot_skipped'
  | 'question_selected'
  | 'escalated'
  | 'summary_generated'
  | 'error'

export interface TraceEvent {
  timestamp: string
  eventType: TraceEventType
  input: Record<string, unknown>
  decision: string
  ruleId: string
  previousStatus: SessionStatus
  nextStatus: SessionStatus
}

export interface ShowWhenCondition {
  slotId: string
  equals: AnswerValue
}

export interface SlotDefinition {
  id: string
  label: string
  question: string
  complaints: ComplaintId[]
  inputType: SlotInputType
  required: boolean
  priority: number
  options?: Array<{ label: string; value: string }>
  min?: number
  max?: number
  unit?: string
  validationMessage?: string
  showWhen?: ShowWhenCondition
  summarySection: 'onset' | 'current' | 'associated' | 'measures'
}

export interface ComplaintRule {
  id: ComplaintId
  displayName: string
  description: string
  terms: string[]
  slots: SlotDefinition[]
}

export interface RiskRule {
  id: string
  label: string
  terms: string[]
  escalationReason: string
}

export interface IntakeSession {
  sessionId: string
  patientGroup: PatientGroup
  patientAge?: number
  chiefComplaints: ComplaintId[]
  answers: Record<string, AnswerValue>
  askedSlotIds: string[]
  skippedSlotIds: string[]
  notApplicableSlotIds: string[]
  currentSlotId: string | null
  turnCount: number
  maxTurns: number
  status: SessionStatus
  escalationReason: string | null
  initialNarrative?: string
  traceEvents: TraceEvent[]
  llmTraceEvents: LlmTraceEvent[]
}

export interface StartSessionInput {
  age: number
  initialText?: string
  quickComplaint?: ComplaintId
}

export interface RiskResult {
  matched: boolean
  ruleId: string
  reason: string | null
  safetyMessage: string | null
}

export interface SlotSelection {
  slot: SlotDefinition | null
  notApplicableSlotIds: string[]
}

export interface SummaryEntry {
  label: string
  value: AnswerValue
  displayValue: string
  source: 'user'
}

export interface IntakeSummary {
  patientType: string
  chiefComplaints: string[]
  onset: SummaryEntry[]
  currentSymptoms: SummaryEntry[]
  associatedSymptoms: SummaryEntry[]
  measuresTaken: SummaryEntry[]
  unansweredInformation: string[]
  skippedInformation: string[]
  notApplicableInformation: string[]
  escalated: boolean
  escalationReason: string | null
  disclaimer: string
}

export interface ControllerResult {
  session: IntakeSession
  question: SlotDefinition | null
  summary: IntakeSummary | null
  message: string
  validationError?: string | null
  extractionNotice?: string | null
  clarificationQuestion?: string | null
}
