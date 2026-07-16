import type { AuditEvent } from '../types'

export type AuditSink = (line: string) => void
export function createAuditLogger(sink: AuditSink = (line) => console.info(line)) {
  return (event: AuditEvent): void => {
    const safeEvent: AuditEvent = {
      requestId: event.requestId, operation: event.operation, provider: event.provider,
      modelAlias: event.modelAlias, timestamp: event.timestamp, latencyMs: event.latencyMs,
      httpStatus: event.httpStatus, outcome: event.outcome, inputCharacters: event.inputCharacters,
      outputCharacters: event.outputCharacters, acceptedCount: event.acceptedCount,
      rejectedCount: event.rejectedCount, errorCategory: event.errorCategory,
    }
    sink(JSON.stringify(safeEvent))
  }
}
