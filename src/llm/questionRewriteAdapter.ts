import { assertPolicySafe } from '../harness/policyGuard'
import { MODEL_BLOCKED_RISK_SLOT_IDS } from './acceptancePolicy'
import { createLlmTrace } from './llmTrace'
import { DEFAULT_LLM_TIMEOUT_MS, withProviderTimeout } from './provider'
import { parseQuestionRewriteResponse } from './schema'
import type {
  CandidateRejectionReason,
  LlmProvider,
  QuestionRewriteRequest,
  QuestionRewriteResult,
} from './types'
import { LLM_SCHEMA_VERSION } from './types'

const MEDICAL_CONCEPTS = [
  '体温', '发热', '发烧', '咳嗽', '痰', '胸痛', '呼吸', '头痛', '畏寒', '寒战',
  '夜间', '处理', '什么时候', '何时', '多久', '持续', '反复',
]

const FORBIDDEN_ADDITIONS = [
  '肺炎', '流感', '新冠', '支气管炎', '药物', '吃药', '用药', '检查', '治疗',
  '严重', '危险', '轻症', '重症', '建议就医', '应该去医院',
]

const OPTIONAL_MARKER = /(?:可以|可)(?:先)?(?:跳过|不答)|未测(?:量)?可以跳过/u
const NEGATIVE_ASSERTION = /(?:没有|并无|否认|未出现|不伴有?|不存在)/u

function hasNegativeAssertion(text: string): boolean {
  return NEGATIVE_ASSERTION.test(text.replace(/有没有|是否有|有无/u, ''))
}

function preservesTemporalMeaning(slotId: string, rewritten: string): boolean {
  if (slotId === 'currentTemperature') {
    return /(?:当前|现在|目前)/u.test(rewritten) && !/(?:最高|峰值)/u.test(rewritten)
  }
  if (slotId === 'maxTemperature') {
    return /(?:最高|峰值|最多烧到)/u.test(rewritten) && !/(?:当前|现在测到)/u.test(rewritten)
  }
  if (slotId === 'duration') {
    return /(?:多久|多长时间|持续)/u.test(rewritten) && !/(?:什么时候开始|何时开始)/u.test(rewritten)
  }
  if (slotId === 'onset') {
    return /(?:什么时候开始|何时开始|从什么时候|起病时间|哪天开始)/u.test(rewritten) &&
      !/(?:持续多久|多长时间)/u.test(rewritten)
  }
  return true
}

function preservesQuestionKind(input: QuestionRewriteRequest, rewritten: string): boolean {
  if (input.inputType === 'boolean') return /(?:是否|有没有|有无|吗|没有)/u.test(rewritten)
  if (input.inputType === 'number') return /(?:多少|几度|体温)/u.test(rewritten)
  if (input.inputType === 'singleSelect') return /(?:还是|哪种|什么|是否)/u.test(rewritten)
  return /[？?]$/u.test(rewritten)
}

function preservesMeaning(input: QuestionRewriteRequest, rewritten: string): boolean {
  const canonical = input.canonicalQuestion
  const canonicalConcepts = MEDICAL_CONCEPTS.filter((term) => canonical.includes(term))
  const rewrittenConcepts = MEDICAL_CONCEPTS.filter((term) => rewritten.includes(term))
  if (canonicalConcepts.length === 0) return false
  if (!canonicalConcepts.some((term) => rewrittenConcepts.includes(term))) return false
  if (!rewrittenConcepts.every((term) => canonicalConcepts.includes(term))) return false
  if (hasNegativeAssertion(canonical) !== hasNegativeAssertion(rewritten)) return false
  if (!preservesTemporalMeaning(input.slotId, rewritten)) return false
  if (!preservesQuestionKind(input, rewritten)) return false
  if (input.unit && !rewritten.includes(input.unit) && !rewritten.includes('度') && !rewritten.includes('体温')) {
    return false
  }
  if (OPTIONAL_MARKER.test(canonical) !== OPTIONAL_MARKER.test(rewritten)) return false
  if (input.required && OPTIONAL_MARKER.test(rewritten)) return false
  return !FORBIDDEN_ADDITIONS.some((term) => rewritten.includes(term) && !canonical.includes(term))
}

export class QuestionRewriteAdapter {
  constructor(
    private readonly provider: LlmProvider,
    private readonly timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
  ) {}

  async rewrite(input: QuestionRewriteRequest, signal?: AbortSignal): Promise<QuestionRewriteResult> {
    const startedAt = Date.now()
    const request: QuestionRewriteRequest = { ...input, schemaVersion: LLM_SCHEMA_VERSION }
    let reason: CandidateRejectionReason | null = null
    let question = request.canonicalQuestion
    let usedRewrite = false

    if (MODEL_BLOCKED_RISK_SLOT_IDS.has(request.slotId)) {
      reason = 'risk_slot_blocked'
      return {
        slotId: request.slotId,
        question,
        usedRewrite,
        trace: createLlmTrace({
          providerName: this.provider.name,
          operation: 'question_rewrite',
          schemaVersion: LLM_SCHEMA_VERSION,
          startedAt,
          outcome: 'risk_blocked',
          rejectedCandidateCount: 1,
          rejectionReasons: [reason],
        }),
      }
    }

    try {
      const raw = await withProviderTimeout(
        (providerSignal) => this.provider.rewriteQuestion(request, providerSignal),
        this.timeoutMs,
        signal,
      )
      const parsed = parseQuestionRewriteResponse(raw)
      if (!parsed.valid || !parsed.value || parsed.value.confidence < 0.9) {
        reason = parsed.reason ?? 'rewrite_invalid'
      } else {
        try {
          assertPolicySafe(parsed.value.rewrittenQuestion)
        } catch {
          reason = 'rewrite_policy_violation'
        }
        if (!reason && !preservesMeaning(request, parsed.value.rewrittenQuestion)) {
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
          : error instanceof Error && error.message === 'provider_aborted'
            ? 'provider_aborted'
            : 'provider_error'
    }

    return {
      slotId: request.slotId,
      question,
      usedRewrite,
      trace: createLlmTrace({
        providerName: this.provider.name,
        operation: 'question_rewrite',
        schemaVersion: LLM_SCHEMA_VERSION,
        startedAt,
        outcome: usedRewrite ? 'accepted' : 'fallback',
        rejectedCandidateCount: reason ? 1 : 0,
        rejectionReasons: reason ? [reason] : [],
      }),
    }
  }
}
