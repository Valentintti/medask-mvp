import type {
  AnswerValue,
  ComplaintId,
  ControllerResult,
  SlotDefinition,
} from '../types/intake'

export const LLM_SCHEMA_VERSION = '1.1' as const
export type LlmSchemaVersion = typeof LLM_SCHEMA_VERSION
export type CandidateStatus =
  | 'asserted'
  | 'negated'
  | 'uncertain'
  | 'historical'
  | 'resolved'
  | 'hypothetical'
export type LlmOperation = 'slot_extraction' | 'question_rewrite'
export type LlmOutcome = 'accepted' | 'clarification' | 'rejected' | 'fallback' | 'risk_blocked'

export interface SlotExtractionRequest {
  supportedComplaints: ComplaintId[]
  allowedSlotIds: string[]
  currentQuestionSlotId: string | null
  userText: string
  existingSlotIds: string[]
  locale: 'zh-CN'
  schemaVersion: LlmSchemaVersion
}

export interface SlotCandidate {
  slotId: string
  value: AnswerValue
  confidence: number
  evidence: string
  status: CandidateStatus
}

export interface SlotExtractionResponse {
  schemaVersion: LlmSchemaVersion
  candidates: SlotCandidate[]
  unresolvedSlotIds: string[]
  needsClarification: boolean
}

export type SlotExtractionRawResponse = unknown

export interface QuestionRewriteRequest {
  schemaVersion: LlmSchemaVersion
  slotId: string
  canonicalQuestion: string
  complaintContext: ComplaintId[]
  required: boolean
  inputType: SlotDefinition['inputType']
  unit?: string
  locale: 'zh-CN'
}

export interface QuestionRewriteResponse {
  schemaVersion: LlmSchemaVersion
  rewrittenQuestion: string
  confidence: number
}

export type QuestionRewriteRawResponse = unknown

export interface LlmProvider {
  readonly name: string
  extractSlots(input: SlotExtractionRequest, signal?: AbortSignal): Promise<SlotExtractionRawResponse>
  rewriteQuestion(input: QuestionRewriteRequest, signal?: AbortSignal): Promise<QuestionRewriteRawResponse>
}

export type CandidateRejectionReason =
  | 'invalid_json'
  | 'schema_invalid'
  | 'extra_field'
  | 'schema_version_mismatch'
  | 'slot_not_allowed'
  | 'slot_unknown'
  | 'value_invalid'
  | 'confidence_low'
  | 'status_not_asserted'
  | 'candidate_negated'
  | 'candidate_uncertain'
  | 'evidence_missing'
  | 'evidence_hallucinated'
  | 'negation_conflict'
  | 'historical_context'
  | 'resolved_context'
  | 'hypothetical_context'
  | 'risk_slot_blocked'
  | 'risk_evidence_detected'
  | 'already_answered_same_value'
  | 'existing_value_conflict'
  | 'provider_error'
  | 'provider_timeout'
  | 'provider_aborted'
  | 'rewrite_invalid'
  | 'rewrite_policy_violation'
  | 'rewrite_meaning_changed'

export interface CandidateRejection {
  slotId: string | null
  reason: CandidateRejectionReason
}

export interface SlotConflict {
  slotId: string
  existingValue: AnswerValue
  proposedValue: AnswerValue
  evidence: string
}

export interface LlmTraceEvent {
  requestId: string
  timestamp: string
  providerName: string
  operation: LlmOperation
  schemaVersion: string
  latencyMs: number
  outcome: LlmOutcome
  acceptedCandidateCount: number
  rejectedCandidateCount: number
  rejectionReasons: CandidateRejectionReason[]
}

export interface ExtractionAdapterInput {
  supportedComplaints: ComplaintId[]
  allowedSlots: SlotDefinition[]
  currentQuestionSlotId: string | null
  userText: string
  existingAnswers: Record<string, AnswerValue>
}

export interface ExtractionAdapterResult {
  acceptedCandidates: SlotCandidate[]
  rejectedCandidates: CandidateRejection[]
  conflicts: SlotConflict[]
  needsClarification: boolean
  fallbackToRules: boolean
  trace: LlmTraceEvent
}

export interface QuestionRewriteResult {
  slotId: string
  question: string
  usedRewrite: boolean
  trace: LlmTraceEvent
}

export interface FreeTextControllerResult extends ControllerResult {
  acceptedSlotIds: string[]
  conflicts: SlotConflict[]
}
