import type { QuestionRewriteRequest, QuestionRewriteResponse, SlotExtractionRequest, SlotExtractionResponse } from '../src/llm/types'

export type ServerOperation = 'extract' | 'rewrite'
export interface ServerConfig {
  enabled: boolean; configured: boolean; apiKey: string; baseUrl: string; model: string
  requestTimeoutMs: number; maxRequestsPerMinute: number; dailyTokenBudget: number
  allowedOrigins: ReadonlySet<string>; host: string; port: number
  deepSeekStrictToolEnabled: boolean
}
export interface ProviderUsage { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
export interface ServerProviderResult {
  rawJson: string; inputCharacters: number; outputCharacters: number; usage: ProviderUsage; upstreamStatus: number
  structuredOutputStrategy?: 'deepseek_strict_tool' | 'json_object_fallback' | 'question_rewrite_json_object'
}
export interface ServerLlmProvider {
  readonly providerAlias: string; readonly modelAlias: string
  extractSlots(input: SlotExtractionRequest, signal?: AbortSignal): Promise<ServerProviderResult>
  rewriteQuestion(input: QuestionRewriteRequest, signal?: AbortSignal): Promise<ServerProviderResult>
}
export interface RouteRequest { method: string; path: string; origin: string | null; contentType: string | null; clientKey: string; bodyText: string; signal?: AbortSignal }
export interface RouteResponse { status: number; headers: Record<string, string>; body: unknown }
export interface AuditEvent {
  requestId: string; operation: ServerOperation; providerAlias: string; modelAlias: string; timestamp: string
  latencyMs: number; httpStatus: number; outcome: string; inputCharacterCount: number; outputCharacterCount: number
  errorCategory: string | null
}
export type ValidatedProviderPayload = SlotExtractionResponse | QuestionRewriteResponse
