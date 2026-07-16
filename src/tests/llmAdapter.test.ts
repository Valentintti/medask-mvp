import { describe, expect, it } from 'vitest'
import { getSessionSlots } from '../engines/slotEngine'
import {
  answerFreeText,
  processExtractionCandidates,
  startSession,
  startSessionWithAdapter,
} from '../harness/intakeController'
import { createIntakeSession } from '../harness/sessionState'
import { runSlotExtractionEval } from '../llm/evals/evaluate'
import { slotExtractionCases } from '../llm/evals/slotExtractionCases'
import { MockLlmProvider } from '../llm/mockProvider'
import type { LlmProvider, QuestionRewriteRequest, SlotExtractionRequest } from '../llm/types'
import { LLM_SCHEMA_VERSION } from '../llm/types'
import { QuestionRewriteAdapter } from '../llm/questionRewriteAdapter'
import { parseSlotExtractionResponse } from '../llm/schema'
import { SlotExtractionAdapter } from '../llm/slotExtractionAdapter'

function extractionContext(complaint: 'fever' | 'cough' = 'fever') {
  const session = createIntakeSession(30)
  session.status = 'collecting'
  session.chiefComplaints = [complaint]
  session.currentSlotId = 'onset'
  session.askedSlotIds = ['onset']
  return {
    session,
    input: {
      supportedComplaints: [complaint] as Array<'fever' | 'cough'>,
      allowedSlots: getSessionSlots(session),
      currentQuestionSlotId: 'onset',
      userText: '我昨天开始发烧',
      existingAnswers: session.answers,
    },
  }
}

function rewriteInput(
  canonicalQuestion = '这些不适大约从什么时候开始？',
  overrides: Partial<QuestionRewriteRequest> = {},
): QuestionRewriteRequest {
  return {
    schemaVersion: LLM_SCHEMA_VERSION,
    slotId: 'onset',
    canonicalQuestion,
    complaintContext: ['fever'],
    required: true,
    inputType: 'text',
    locale: 'zh-CN',
    ...overrides,
  }
}

const rewriteResponse = (rewrittenQuestion: string, confidence = 0.99) => ({
  schemaVersion: LLM_SCHEMA_VERSION,
  rewrittenQuestion,
  confidence,
})

describe('Provider、Schema 与接受策略', () => {
  it('Provider接口可以替换', async () => {
    const provider: LlmProvider = {
      name: 'replaceable-provider',
      async extractSlots(_input: SlotExtractionRequest) {
        return { schemaVersion: '1.1', candidates: [], unresolvedSlotIds: [], needsClarification: false }
      },
      async rewriteQuestion(input) {
        return rewriteResponse(input.canonicalQuestion, 1)
      },
    }
    const result = await new SlotExtractionAdapter(provider).extract(extractionContext().input)
    expect(result.trace.providerName).toBe('replaceable-provider')
  })

  it('Mock合法输出可以提取槽位', async () => {
    const result = await new SlotExtractionAdapter(new MockLlmProvider()).extract(extractionContext().input)
    expect(result.acceptedCandidates).toEqual([
      expect.objectContaining({ slotId: 'onset', value: '昨天' }),
    ])
  })

  it('非法JSON被拒绝', async () => {
    const context = extractionContext()
    context.input.userText = '__INVALID_JSON__'
    const result = await new SlotExtractionAdapter(new MockLlmProvider()).extract(context.input)
    expect(result.fallbackToRules).toBe(true)
    expect(result.rejectedCandidates[0].reason).toBe('invalid_json')
  })

  it('多余字段默认拒绝', async () => {
    const context = extractionContext()
    context.input.userText = '__EXTRA_FIELD__'
    const result = await new SlotExtractionAdapter(new MockLlmProvider()).extract(context.input)
    expect(result.rejectedCandidates[0].reason).toBe('extra_field')
  })

  it('候选中的多余字段也被拒绝', () => {
    const raw = { schemaVersion: '1.1', candidates: [{ slotId: 'onset', value: '昨天', confidence: .9, evidence: '昨天', status: 'asserted', diagnosis: '禁止' }], unresolvedSlotIds: [], needsClarification: false }
    expect(parseSlotExtractionResponse(raw).reason).toBe('extra_field')
  })

  it('不存在的slotId被拒绝', async () => {
    const context = extractionContext()
    context.input.userText = '模型返回不存在槽位'
    const result = await new SlotExtractionAdapter(new MockLlmProvider()).extract(context.input)
    expect(result.rejectedCandidates[0].reason).toBe('slot_not_allowed')
  })

  it('数值越界被拒绝', async () => {
    const context = extractionContext()
    context.input.userText = '模型返回999度'
    const result = await new SlotExtractionAdapter(new MockLlmProvider()).extract(context.input)
    expect(result.rejectedCandidates[0].reason).toBe('value_invalid')
  })

  it('evidence不在原文被拒绝', async () => {
    const context = extractionContext()
    context.input.userText = '模型返回幻觉证据'
    const result = await new SlotExtractionAdapter(new MockLlmProvider()).extract(context.input)
    expect(result.rejectedCandidates[0].reason).toBe('evidence_hallucinated')
  })

  it('confidence低于阈值不写入', async () => {
    const context = extractionContext('cough')
    context.input.userText = '可能有点发烧吧'
    const result = await new SlotExtractionAdapter(new MockLlmProvider()).extract(context.input)
    expect(result.acceptedCandidates).toHaveLength(0)
    expect(result.rejectedCandidates[0].reason).toBe('confidence_low')
  })

  it('uncertain不写入', async () => {
    const context = extractionContext('cough')
    context.input.userText = '可能有点发烧吧'
    const result = await new SlotExtractionAdapter(new MockLlmProvider(), { confidenceThreshold: .5 }).extract(context.input)
    expect(result.rejectedCandidates[0].reason).toBe('candidate_uncertain')
  })

  it('否定表达不被asserted接受', async () => {
    const context = extractionContext('cough')
    context.input.userText = '没有发热'
    const provider = new MockLlmProvider({ responses: { '没有发热': { schemaVersion: '1.1', candidates: [{ slotId: 'feverAssociated', value: true, confidence: .99, evidence: '没有发热', status: 'asserted' }], unresolvedSlotIds: [], needsClarification: false } } })
    const result = await new SlotExtractionAdapter(provider).extract(context.input)
    expect(result.rejectedCandidates[0].reason).toBe('negation_conflict')
  })

  it('风险槽位不能由模型自动写入', async () => {
    const context = extractionContext()
    context.input.userText = '没有胸痛'
    const result = await new SlotExtractionAdapter(new MockLlmProvider()).extract(context.input)
    expect(result.acceptedCandidates).toHaveLength(0)
    expect(result.rejectedCandidates[0].reason).toBe('risk_slot_blocked')
  })

  it('候选值含风险表达时再次交给riskEngine并拒绝', async () => {
    const context = extractionContext()
    context.input.userText = '今天有变化'
    const provider = new MockLlmProvider({ responses: { '今天有变化': { schemaVersion: '1.1', candidates: [{ slotId: 'onset', value: '胸痛', confidence: .99, evidence: '今天', status: 'asserted' }], unresolvedSlotIds: [], needsClarification: false } } })
    const result = await new SlotExtractionAdapter(provider).extract(context.input)
    expect(result.rejectedCandidates[0].reason).toBe('risk_evidence_detected')
  })

  it('Provider收到的请求只包含最小字段', async () => {
    const provider = new MockLlmProvider()
    await new SlotExtractionAdapter(provider).extract(extractionContext().input)
    expect(Object.keys(provider.lastExtractionRequest!).sort()).toEqual([
      'allowedSlotIds', 'currentQuestionSlotId', 'existingSlotIds', 'locale',
      'schemaVersion', 'supportedComplaints', 'userText',
    ])
    expect(JSON.stringify(provider.lastExtractionRequest)).not.toContain('escalationReason')
    expect(JSON.stringify(provider.lastExtractionRequest)).not.toContain('traceEvents')
  })
})

describe('风险顺序、冲突与失败回退', () => {
  it('风险命中时模型调用次数为0', async () => {
    const provider = new MockLlmProvider()
    const adapter = new SlotExtractionAdapter(provider)
    const base = startSession({ age: 30, quickComplaint: 'cough' })
    const result = await answerFreeText(base.session, '喘不上气', adapter)
    expect(result.session.status).toBe('escalated')
    expect(provider.extractionCallCount).toBe(0)
  })

  it('风险引擎先于模型调用并且模型不能取消升级', async () => {
    const provider = new MockLlmProvider({ responses: { '现在胸痛': { schemaVersion: '1.1', candidates: [], unresolvedSlotIds: [], needsClarification: false } } })
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    const result = await answerFreeText(base.session, '现在胸痛', new SlotExtractionAdapter(provider))
    expect(result.session.status).toBe('escalated')
    expect(result.session.traceEvents.some((event) => event.ruleId === 'risk.chest_pain.explicit')).toBe(true)
    expect(provider.extractionCallCount).toBe(0)
  })

  it('已有答案冲突生成固定澄清问题且不覆盖', async () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    base.session.answers.currentTemperature = 38.5
    const provider = new MockLlmProvider({ responses: { '现在已经37度': { schemaVersion: '1.1', candidates: [{ slotId: 'currentTemperature', value: 37, confidence: .99, evidence: '37度', status: 'asserted' }], unresolvedSlotIds: [], needsClarification: false } } })
    const result = await answerFreeText(base.session, '现在已经37度', new SlotExtractionAdapter(provider))
    expect(result.session.answers.currentTemperature).toBe(38.5)
    expect(result.clarificationQuestion).toBe('你之前提供的是38.5℃，现在提到37℃。请确认当前体温是多少？')
  })

  it('Provider异常自动回退标准问题', async () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    const provider = new MockLlmProvider({ throwInputs: ['故障输入'] })
    const result = await answerFreeText(base.session, '故障输入', new SlotExtractionAdapter(provider))
    expect(result.session.status).toBe('collecting')
    expect(result.extractionNotice).toBe('自然语言辅助暂时不可用，你仍可继续按标准问题完成信息整理。')
  })

  it('Provider超时自动回退', async () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    const provider = new MockLlmProvider({ delayMs: 30 })
    const result = await answerFreeText(base.session, '普通输入', new SlotExtractionAdapter(provider, { timeoutMs: 5 }))
    expect(result.session.status).toBe('collecting')
    expect(result.session.llmTraceEvents[0].rejectionReasons).toContain('provider_timeout')
  })

  it('每轮最多调用一次槽位提取', async () => {
    const provider = new MockLlmProvider()
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    await answerFreeText(base.session, '我昨天开始发烧', new SlotExtractionAdapter(provider))
    expect(provider.extractionCallCount).toBe(1)
  })

  it('Adapter关闭时同步规则行为完全一致', async () => {
    const direct = startSession({ age: 30, initialText: '昨天开始发烧' })
    const guarded = await startSessionWithAdapter({ age: 30, initialText: '昨天开始发烧' }, null)
    expect(guarded.session.status).toBe(direct.session.status)
    expect(guarded.session.answers).toEqual(direct.session.answers)
    expect(guarded.question?.id).toBe(direct.question?.id)
  })

  it('processExtractionCandidates只由Harness写入answers', async () => {
    const context = extractionContext()
    const adapterResult = await new SlotExtractionAdapter(new MockLlmProvider()).extract(context.input)
    expect(context.session.answers.onset).toBeUndefined()
    const processed = processExtractionCandidates(context.session, adapterResult)
    expect(processed.session.answers.onset).toBe('昨天')
  })
})

describe('问题改写与非敏感Trace', () => {
  it('合法问题改写保留同一slotId', async () => {
    const result = await new QuestionRewriteAdapter(new MockLlmProvider()).rewrite(rewriteInput())
    expect(result.slotId).toBe('onset')
    expect(result.usedRewrite).toBe(true)
  })

  it('问题改写不会修改槽位规则对象', async () => {
    const session = createIntakeSession(30)
    session.chiefComplaints = ['fever']
    const original = getSessionSlots(session).find((slot) => slot.id === 'onset')!
    const snapshot = structuredClone(original)
    await new QuestionRewriteAdapter(new MockLlmProvider()).rewrite(rewriteInput(original.question, {
      slotId: original.id,
      required: original.required,
      inputType: original.inputType,
      unit: original.unit,
    }))
    expect(original).toEqual(snapshot)
  })

  it('非法改写回退标准问题', async () => {
    const provider = new MockLlmProvider({ rewriteResponses: { onset: rewriteResponse('') } })
    const canonical = '这些不适大约从什么时候开始？'
    const result = await new QuestionRewriteAdapter(provider).rewrite(rewriteInput(canonical))
    expect(result.question).toBe(canonical)
    expect(result.usedRewrite).toBe(false)
  })

  it('增加新医学问题的改写被拒绝', async () => {
    const provider = new MockLlmProvider({ rewriteResponses: { onset: rewriteResponse('什么时候开始，同时有没有胸痛？') } })
    const canonical = '这些不适大约从什么时候开始？'
    const result = await new QuestionRewriteAdapter(provider).rewrite(rewriteInput(canonical))
    expect(result.question).toBe(canonical)
    expect(result.trace.rejectionReasons).toContain('rewrite_meaning_changed')
  })

  it('诊断式改写被policyGuard拒绝', async () => {
    const provider = new MockLlmProvider({ rewriteResponses: { onset: rewriteResponse('什么时候开始？你诊断为肺炎。') } })
    const canonical = '这些不适大约从什么时候开始？'
    const result = await new QuestionRewriteAdapter(provider).rewrite(rewriteInput(canonical))
    expect(result.question).toBe(canonical)
    expect(result.trace.rejectionReasons).toContain('rewrite_policy_violation')
  })

  it('LLM Trace不记录用户原文、evidence或API Key', async () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    const result = await answerFreeText(base.session, '我昨天开始发烧 API_KEY_SECRET', new SlotExtractionAdapter(new MockLlmProvider({ responses: { '我昨天开始发烧 API_KEY_SECRET': { schemaVersion: '1.1', candidates: [{ slotId: 'onset', value: '昨天', confidence: .99, evidence: '昨天开始', status: 'asserted' }], unresolvedSlotIds: [], needsClarification: false } } })))
    const serialized = JSON.stringify(result.session.llmTraceEvents)
    expect(serialized).not.toContain('我昨天开始发烧')
    expect(serialized).not.toContain('昨天开始')
    expect(serialized).not.toContain('API_KEY_SECRET')
  })
})

describe('合成离线评测', () => {
  it('评测集至少30条且不含外部数据依赖', () => {
    expect(slotExtractionCases).toHaveLength(30)
    expect(slotExtractionCases.every((item) => item.id && item.userText)).toBe(true)
  })

  it('合成评测结果可重复', async () => {
    expect(await runSlotExtractionEval()).toEqual(await runSlotExtractionEval())
  })

  it('hallucinated evidence计数为0', async () => {
    expect((await runSlotExtractionEval()).hallucinatedEvidenceCount).toBe(0)
  })

  it('false risk override计数为0', async () => {
    expect((await runSlotExtractionEval()).falseRiskOverrideCount).toBe(0)
  })

  it('非法输出拒绝率为100%', async () => {
    expect((await runSlotExtractionEval()).invalidOutputRejectionRate).toBe(1)
  })
})
