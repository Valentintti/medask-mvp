import type { TraceEvent } from '../types/intake'
import type { LlmTraceEvent } from '../llm/types'

export function TracePanel({ events, llmEvents = [] }: { events: TraceEvent[]; llmEvents?: LlmTraceEvent[] }) {
  if (!import.meta.env.DEV) return null

  return (
    <details className="trace-panel">
      <summary>开发模式 Trace（仅当前会话）</summary>
      <p>不会写入浏览器控制台，也不会持久化。</p>
      <ol>
        {events.map((event, index) => (
          <li key={`${event.timestamp}-${index}`}>
            <code>{event.eventType}</code>
            <span>{event.decision}</span>
            <small>
              {event.previousStatus} → {event.nextStatus} · {event.ruleId}
            </small>
          </li>
        ))}
      </ol>
      {llmEvents.length > 0 && (
        <>
          <h3>模型适配器元数据</h3>
          <ol>
            {llmEvents.map((event) => (
              <li key={event.requestId}>
                <code>{event.operation}</code>
                <span>{event.outcome}</span>
                <small>
                  {event.providerName} · 接受 {event.acceptedCandidateCount} · 拒绝 {event.rejectedCandidateCount}
                  {event.rejectionReasons.length > 0 ? ` · ${event.rejectionReasons.join(', ')}` : ''}
                </small>
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  )
}
