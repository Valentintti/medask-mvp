export function estimateTokensFromCharacters(characterCount: number): number {
  return Math.max(1, Math.ceil(characterCount / 2))
}

// Demo 使用单进程内存门禁：进程重启后计数会重置，多实例之间也不会共享状态。
// 生产环境必须迁移到 Redis、API Gateway 或等效的集中式限流与预算服务。
export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, number[]>()
  constructor(private readonly maximum: number, private readonly windowMs = 60_000) {}
  consume(key: string, now = Date.now()): boolean {
    const recent = (this.entries.get(key) ?? []).filter((timestamp) => now - timestamp < this.windowMs)
    if (recent.length >= this.maximum) { this.entries.set(key, recent); return false }
    recent.push(now); this.entries.set(key, recent); return true
  }
}
export class DailyTokenBudget {
  private day = ''
  private used = 0
  constructor(private readonly maximum: number) {}
  reserve(tokens: number, now = new Date()): boolean {
    const day = now.toISOString().slice(0, 10)
    if (day !== this.day) { this.day = day; this.used = 0 }
    if (tokens < 0 || this.used + tokens > this.maximum) return false
    this.used += tokens; return true
  }
  usage(): number { return this.used }
}
export class OncePerOperationGate {
  private readonly seen = new Map<string, number>()
  constructor(private readonly ttlMs = 15_000) {}
  consume(key: string, now = Date.now()): boolean {
    for (const [storedKey, expiresAt] of this.seen) if (expiresAt <= now) this.seen.delete(storedKey)
    if ((this.seen.get(key) ?? 0) > now) return false
    this.seen.set(key, now + this.ttlMs); return true
  }
}
