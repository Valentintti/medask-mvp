export type ProductEventType =
  | 'session_started'
  | 'complaint_selected'
  | 'question_answered'
  | 'question_skipped'
  | 'llm_available'
  | 'llm_fallback'
  | 'risk_escalated'
  | 'summary_completed'
  | 'session_restarted'

export interface ProductEvent {
  eventType: ProductEventType
  timestamp: string
}

const inMemoryEvents: ProductEvent[] = []

// 产品事件只记录事件类型与时间，不接收任何患者文本、答案、年龄、evidence或模型输出。
export function recordProductEvent(eventType: ProductEventType): void {
  inMemoryEvents.push({ eventType, timestamp: new Date().toISOString() })
}

export function getProductEvents(): readonly ProductEvent[] {
  return [...inMemoryEvents]
}

export function clearProductEvents(): void {
  inMemoryEvents.length = 0
}
