import { assertPolicySafe } from '../harness/policyGuard'
import { createLlmTrace } from './llmTrace'
import { DEFAULT_LLM_TIMEOUT_MS, withProviderTimeout } from './provider'
import { parseQuestionRewriteResponse } from './schema'
import type {
  CandidateRejectionReason,
  LlmProvider,
  QuestionRewriteRequest,
  QuestionRewriteResult,
} from './types'

const MEDICAL_CONCEPTS = [
  '体温', '发热', '发烧', '咳嗽', '痰', '胸痛', '呼吸', '头痛', '畏寒', '寒战',
  '夜间', '处理', '什么时候', '何时', '多久', '持续', '反复',
]

function preservesMeaning(canonical: string, rewritten: string): boolean {
  const canonicalConcepts = MEDICAL_CONCEPTS.filter((term) => canonical.includes(term))
  const rewrittenConcepts = MEDICAL_CONCEPTS.filter((term) => rewritten.includes(term))
  if (canonicalConcepts.length === 0) return false
  if (!canonicalConcepts.some((term) => rewrittenConcepts.includes(term))) return false
  return rewrittenConcepts.every((term) => canonicalConcepts.includes(term))
}

export class QuestionRewriteAdapter {
  constructor(
    private readonly provider: LlmProvider,
    private readonly timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
  ) {}

  async rewrite(input: QuestionRewriteRequest): Promise<QuestionRewriteResult> {
    const startedAt = Date.now()
    let reason: CandidateRejectionReason | null = null
    let question = input.canonicalQuestion
    let usedRewrite = false

    try {
      const raw = await withProviderTimeout(this.provider.rewriteQuestion(input), this.timeoutMs)
      const parsed = parseQuestionRewriteResponse(raw)
      if (!parsed.valid || !parsed.value || parsed.value.confidence < 0.9) {
        reason = parsed.reason ?? 'rewrite_invalid'
      } else {
        try {
          assertPolicySafe(parsed.value.rewrittenQuestion)
        } catch {
          reason = 'rewrite_policy_violation'
        }
        if (!reason && !preservesMeaning(input.canonicalQuestion, parsed.value.rewrittenQuestion)) {
          reason = 'rewrite_meaning_changed'
        }
        if (!reason) {
          question = parsed.value.rewrittenQuestion
          usedRewrite = true
        }
      }
    } catch (error) {
      reason =
        error instanceof Error && error.message === 'provider_timeout'
          ? 'provider_timeout'
          : 'provider_error'
    }

    return {
      slotId: input.slotId,
      question,
      usedRewrite,
      trace: createLlmTrace({
        providerName: this.provider.name,
        operation: 'question_rewrite',
        schemaVersion: '1.0',
        startedAt,
        outcome: usedRewrite ? 'accepted' : 'fallback',
        rejectedCandidateCount: reason ? 1 : 0,
        rejectionReasons: reason ? [reason] : [],
      }),
    }
  }
}
