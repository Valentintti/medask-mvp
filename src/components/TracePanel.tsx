import type { TraceEvent } from '../types/intake'

export function TracePanel({ events }: { events: TraceEvent[] }) {
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
    </details>
  )
}
