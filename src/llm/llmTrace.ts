import type {
  CandidateRejectionReason,
  LlmOperation,
  LlmOutcome,
  LlmTraceEvent,
} from './types'
import type { IntakeSession } from '../types/intake'

function requestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `llm-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createLlmTrace(input: {
  providerName: string
  operation: LlmOperation
  schemaVersion: string
  startedAt: number
  outcome: LlmOutcome
  acceptedCandidateCount?: number
  rejectedCandidateCount?: number
  rejectionReasons?: CandidateRejectionReason[]
}): LlmTraceEvent {
  return {
    requestId: requestId(),
    timestamp: new Date().toISOString(),
    providerName: input.providerName,
    operation: input.operation,
    schemaVersion: input.schemaVersion,
    latencyMs: Math.max(0, Date.now() - input.startedAt),
    outcome: input.outcome,
    acceptedCandidateCount: input.acceptedCandidateCount ?? 0,
    rejectedCandidateCount: input.rejectedCandidateCount ?? 0,
    rejectionReasons: [...new Set(input.rejectionReasons ?? [])],
  }
}

export function appendLlmTrace(session: IntakeSession, trace: LlmTraceEvent): IntakeSession {
  return { ...session, llmTraceEvents: [...session.llmTraceEvents, trace] }
}
