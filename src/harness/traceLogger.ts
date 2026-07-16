import type { IntakeSession, SessionStatus, TraceEvent, TraceEventType } from '../types/intake'

interface TraceInput {
  eventType: TraceEventType
  input?: Record<string, unknown>
  decision: string
  ruleId: string
  previousStatus?: SessionStatus
  nextStatus?: SessionStatus
}

/** Trace 仅保存在当前会话对象中；此模块不会向浏览器控制台输出用户内容。 */
export function appendTrace(session: IntakeSession, event: TraceInput): IntakeSession {
  const traceEvent: TraceEvent = {
    timestamp: new Date().toISOString(),
    eventType: event.eventType,
    input: event.input ?? {},
    decision: event.decision,
    ruleId: event.ruleId,
    previousStatus: event.previousStatus ?? session.status,
    nextStatus: event.nextStatus ?? session.status,
  }

  return { ...session, traceEvents: [...session.traceEvents, traceEvent] }
}
