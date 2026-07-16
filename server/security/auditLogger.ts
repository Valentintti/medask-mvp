import type { AuditEvent } from '../types'

export type AuditSink = (line: string) => void
export function createAuditLogger(sink: AuditSink = (line) => console.info(line)) {
  return (event: AuditEvent): void => {
    const safeEvent: AuditEvent = {
      requestId: event.requestId, operation: event.operation, providerAlias: event.providerAlias,
      modelAlias: event.modelAlias, timestamp: event.timestamp, latencyMs: event.latencyMs,
      httpStatus: event.httpStatus, outcome: event.outcome, inputCharacterCount: event.inputCharacterCount,
      outputCharacterCount: event.outputCharacterCount, errorCategory: event.errorCategory,
    }
    sink(JSON.stringify(safeEvent))
  }
}
