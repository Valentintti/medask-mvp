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
import { createLlmTrace } from '../llm/llmTrace'
import { MockLlmProvider } from '../llm/mockProvider'
import { QuestionRewriteAdapter } from '../llm/questionRewriteAdapter'
import { parseSlotExtractionResponse } from '../llm/schema'
import { SlotExtractionAdapter } from '../llm/slotExtractionAdapter'
import type {
  CandidateStatus,
  ExtractionAdapterInput,
  ExtractionAdapterResult,
  QuestionRewriteRequest,
  SlotCandidate,
} from '../llm/types'
import { LLM_SCHEMA_VERSION } from '../llm/types'

const response = (
  candidates: SlotCandidate[],
  unresolvedSlotIds: string[] = [],
  needsClarification = false,
) => ({ schemaVersion: LLM_SCHEMA_VERSION, candidates, unresolvedSlotIds, needsClarification })

const candidate = (
  slotId: string,
  value: SlotCandidate['value'],
  evidence: string,
  status: CandidateStatus = 'asserted',
  confidence = 0.99,
): SlotCandidate => ({ slotId, value, evidence, status, confidence })

function extractionInput(
  userText: string,
  complaint: 'fever' | 'cough' = 'cough',
  existingAnswers: Record<string, SlotCandidate['value']> = {},
): ExtractionAdapterInput {
  const session = createIntakeSession(30)
  session.status = 'collecting'
  session.chiefComplaints = [complaint]
  session.answers = { ...existingAnswers }
  session.currentSlotId = 'onset'
  return {
    supportedComplaints: [complaint],
    allowedSlots: getSessionSlots(session),
    currentQuestionSlotId: 'onset',
    userText,
    existingAnswers: session.answers,
  }
}

async function extractWith(
  userText: string,
  candidates: SlotCandidate[],
  complaint: 'fever' | 'cough' = 'cough',
  existingAnswers: Record<string, SlotCandidate['value']> = {},
) {
  const provider = new MockLlmProvider({ responses: { [userText]: response(candidates) } })
  return new SlotExtractionAdapter(provider).extract(
    extractionInput(userText, complaint, existingAnswers),
  )
}

function rewriteRequest(
  slotId: string,
  canonicalQuestion: string,
  overrides: Partial<QuestionRewriteRequest> = {},
): QuestionRewriteRequest {
  return {
    schemaVersion: LLM_SCHEMA_VERSION,
    slotId,
    canonicalQuestion,
    complaintContext: ['fever'],
    required: true,
    inputType: 'text',
    locale: 'zh-CN',
    ...overrides,
  }
}

const rewriteResponse = (rewrittenQuestion: string) => ({
  schemaVersion: LLM_SCHEMA_VERSION,
  rewrittenQuestion,
  confidence: 0.99,
})

describe('evidence完整原文局部语境', () => {
  it('模型缩短evidence也不能绕过没有发热', async () => {
    const result = await extractWith('没有发热', [candidate('feverAssociated', true, '发热')])
    expect(result.acceptedCandidates).toHaveLength(0)
    expect(result.rejectedCandidates[0].reason).toBe('negation_conflict')
  })

  it('同词多次出现时存在当前肯定位置即可接受', async () => {
    const result = await extractWith(
      '没有发热，但现在发热',
      [candidate('feverAssociated', true, '发热')],
    )
    expect(result.acceptedCandidates).toEqual([
      expect.objectContaining({ slotId: 'feverAssociated', value: true }),
    ])
  })

  it.each([
    ['historical', '以前发热', 'historical_context'],
    ['resolved', '烧退了', 'resolved_context'],
    ['hypothetical', '担心以后会发热', 'hypothetical_context'],
  ] as const)('%s候选不写入当前答案', async (status, text, reason) => {
    const result = await extractWith(text, [candidate('feverAssociated', true, text, status)])
    expect(result.acceptedCandidates).toHaveLength(0)
    expect(result.rejectedCandidates[0].reason).toBe(reason)
    expect(result.needsClarification).toBe(true)
  })

  it.each([
    ['以前发热', 'historical_context'],
    ['发热现在好了', 'resolved_context'],
    ['如果以后发热', 'hypothetical_context'],
  ] as const)('asserted也必须服从完整原文语境：%s', async (text, reason) => {
    const result = await extractWith(text, [candidate('feverAssociated', true, '发热')])
    expect(result.acceptedCandidates).toHaveLength(0)
    expect(result.rejectedCandidates[0].reason).toBe(reason)
  })
})

describe('已有答案与Schema约束', () => {
  it('Provider请求使用1.1且旧响应版本被拒绝', async () => {
    const provider = new MockLlmProvider({
      responses: {
        旧版本: { schemaVersion: '1.0', candidates: [], unresolvedSlotIds: [], needsClarification: false },
      },
    })
    const result = await new SlotExtractionAdapter(provider).extract(extractionInput('旧版本'))
    expect(provider.lastExtractionRequest?.schemaVersion).toBe(LLM_SCHEMA_VERSION)
    expect(result.rejectedCandidates[0].reason).toBe('schema_version_mismatch')
  })

  it('相同数值答案是no-op且不形成冲突', async () => {
    const result = await extractWith(
      '现在还是38.5度',
      [candidate('currentTemperature', '38.5', '38.5度')],
      'fever',
      { currentTemperature: 38.5 },
    )
    expect(result.acceptedCandidates).toHaveLength(0)
    expect(result.conflicts).toHaveLength(0)
    expect(result.rejectedCandidates[0].reason).toBe('already_answered_same_value')
    expect(result.needsClarification).toBe(false)
  })

  it('不同答案生成冲突且不覆盖', async () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    base.session.answers.currentTemperature = 38.5
    const provider = new MockLlmProvider({
      responses: {
        '现在37度': response([candidate('currentTemperature', 37, '37度')]),
      },
    })
    const result = await answerFreeText(
      base.session,
      '现在37度',
      new SlotExtractionAdapter(provider),
    )
    expect(result.conflicts).toHaveLength(1)
    expect(result.session.answers.currentTemperature).toBe(38.5)
    expect(result.clarificationQuestion).toContain('请确认当前体温')
  })

  it('unresolvedSlotIds未知值拒绝整个响应', async () => {
    const provider = new MockLlmProvider({
      responses: { 未解决: response([], ['diagnosis']) },
    })
    const result = await new SlotExtractionAdapter(provider).extract(extractionInput('未解决'))
    expect(result.fallbackToRules).toBe(true)
    expect(result.rejectedCandidates[0].reason).toBe('slot_not_allowed')
  })

  it('诊断或状态控制等多余键仍被拒绝', () => {
    const raw = {
      ...response([candidate('onset', '昨天', '昨天')]),
      diagnosis: '肺炎',
      turnCount: 99,
    }
    expect(parseSlotExtractionResponse(raw, ['onset']).reason).toBe('extra_field')
  })
})

describe('问题改写语义护栏', () => {
  it('否定极性变化回退标准问题', async () => {
    const canonical = '咳嗽时是否同时有发热？'
    const provider = new MockLlmProvider({
      rewriteResponses: { feverAssociated: rewriteResponse('咳嗽时是否没有发热？') },
    })
    const result = await new QuestionRewriteAdapter(provider).rewrite(
      rewriteRequest('feverAssociated', canonical, { inputType: 'boolean' }),
    )
    expect(result.usedRewrite).toBe(false)
    expect(result.question).toBe(canonical)
  })

  it('当前体温不能改成最高体温', async () => {
    const canonical = '如果测量过，当前体温是多少？未测量可以跳过。'
    const provider = new MockLlmProvider({
      rewriteResponses: { currentTemperature: rewriteResponse('这次最高体温是多少？未测量可以跳过。') },
    })
    const result = await new QuestionRewriteAdapter(provider).rewrite(
      rewriteRequest('currentTemperature', canonical, {
        required: false,
        inputType: 'number',
        unit: '℃',
      }),
    )
    expect(result.usedRewrite).toBe(false)
  })

  it('持续多久不能改成什么时候开始', async () => {
    const canonical = '咳嗽持续多久了？'
    const provider = new MockLlmProvider({
      rewriteResponses: { duration: rewriteResponse('咳嗽是什么时候开始的？') },
    })
    const result = await new QuestionRewriteAdapter(provider).rewrite(
      rewriteRequest('duration', canonical),
    )
    expect(result.usedRewrite).toBe(false)
  })

  it('风险问题Provider调用次数为0', async () => {
    const provider = new MockLlmProvider({
      rewriteResponses: { chestPain: rewriteResponse('现在是否没有胸痛？') },
    })
    const canonical = '现在是否有明确胸痛？'
    const result = await new QuestionRewriteAdapter(provider).rewrite(
      rewriteRequest('chestPain', canonical, { inputType: 'boolean' }),
    )
    expect(result.question).toBe(canonical)
    expect(provider.rewriteCallCount).toBe(0)
  })

  it('合法口语化改写通过', async () => {
    const result = await new QuestionRewriteAdapter(new MockLlmProvider()).rewrite(
      rewriteRequest('onset', '这些不适大约从什么时候开始？'),
    )
    expect(result.usedRewrite).toBe(true)
    expect(result.question).toContain('什么时候开始')
  })
})

describe('取消、迟到响应和Harness二次校验', () => {
  it('外部AbortSignal会真正取消Mock Provider', async () => {
    const provider = new MockLlmProvider({ delayMs: 100 })
    const controller = new AbortController()
    const pending = new SlotExtractionAdapter(provider, { timeoutMs: 1000 }).extract(
      extractionInput('普通输入'),
      controller.signal,
    )
    controller.abort(new Error('provider_aborted'))
    const result = await pending
    expect(result.rejectedCandidates[0].reason).toBe('provider_aborted')
    expect(provider.abortedExtractionCount).toBe(1)
  })

  it('超时后的迟到结果不会写入Session', async () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    const provider = new MockLlmProvider({
      delayMs: 40,
      responses: {
        '昨天开始': response([candidate('onset', '昨天', '昨天开始')]),
      },
    })
    const result = await answerFreeText(
      base.session,
      '昨天开始',
      new SlotExtractionAdapter(provider, { timeoutMs: 5 }),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(result.session.answers.onset).toBeUndefined()
    expect(provider.abortedExtractionCount).toBe(1)
  })

  it('会话重启后旧请求被取消且新Session保持空Trace', async () => {
    const oldSession = startSession({ age: 30, quickComplaint: 'fever' }).session
    const provider = new MockLlmProvider({ delayMs: 100 })
    const controller = new AbortController()
    const pending = answerFreeText(
      oldSession,
      '普通输入',
      new SlotExtractionAdapter(provider),
      controller.signal,
    )
    controller.abort(new Error('provider_aborted'))
    const newSession = startSession({ age: 30, quickComplaint: 'cough' }).session
    await pending
    expect(newSession.sessionId).not.toBe(oldSession.sessionId)
    expect(newSession.llmTraceEvents).toHaveLength(0)
    expect(newSession.answers).toEqual({})
  })

  it('关闭Adapter时纯规则流程完全一致', async () => {
    const input = { age: 30, initialText: '昨天开始发烧' }
    const direct = startSession(input)
    const guarded = await startSessionWithAdapter(input, null)
    expect(guarded.session.answers).toEqual(direct.session.answers)
    expect(guarded.session.status).toBe(direct.session.status)
    expect(guarded.question?.id).toBe(direct.question?.id)
  })

  it('开启Mock时合法普通槽位由Harness接受', async () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    const result = await answerFreeText(
      base.session,
      '我昨天开始发烧',
      new SlotExtractionAdapter(new MockLlmProvider()),
    )
    expect(result.session.answers.onset).toBe('昨天')
  })

  it('伪造acceptedCandidate仍不能写风险槽位或操纵轮数', () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    const originalTurnCount = base.session.turnCount
    const extraction: ExtractionAdapterResult = {
      acceptedCandidates: [candidate('chestPain', true, '胸痛')],
      rejectedCandidates: [],
      conflicts: [],
      needsClarification: false,
      fallbackToRules: false,
      trace: createLlmTrace({
        providerName: 'malicious-mock',
        operation: 'slot_extraction',
        schemaVersion: LLM_SCHEMA_VERSION,
        startedAt: Date.now(),
        outcome: 'accepted',
        acceptedCandidateCount: 1,
      }),
    }
    const result = processExtractionCandidates(base.session, extraction)
    expect(result.session.answers.chestPain).toBeUndefined()
    expect(result.session.turnCount).toBe(originalTurnCount)
  })

  it('LLM Trace不包含userText或evidence', async () => {
    const base = startSession({ age: 30, quickComplaint: 'fever' })
    const result = await answerFreeText(
      base.session,
      '我昨天开始发烧 SECRET_TEXT',
      new SlotExtractionAdapter(new MockLlmProvider({
        responses: {
          '我昨天开始发烧 SECRET_TEXT': response([candidate('onset', '昨天', '昨天开始')]),
        },
      })),
    )
    const trace = JSON.stringify(result.session.llmTraceEvents)
    expect(trace).not.toContain('SECRET_TEXT')
    expect(trace).not.toContain('昨天开始')
    expect(trace).not.toContain('userText')
    expect(trace).not.toContain('evidence')
  })
})

describe('离线评测分母', () => {
  it('风险和非法输出不进入有效提取exact-match分母', async () => {
    const metrics = await runSlotExtractionEval()
    expect(metrics.counts.validExtractionExactMatch.denominator).toBe(metrics.validExtractionCaseCount)
    expect(metrics.validExtractionCaseCount).toBeLessThan(metrics.caseCount)
    expect(metrics.counts.riskPreemptionRate.denominator).toBeGreaterThan(0)
    expect(metrics.counts.invalidOutputRejectionRate.denominator).toBeGreaterThan(0)
  })

  it('空分母不会被无条件记为100%', async () => {
    const metrics = await runSlotExtractionEval()
    for (const item of Object.values(metrics.counts)) {
      if (item.denominator === 0) expect(item.value).toBe(0)
    }
  })

  it('风险覆盖错误保持为0', async () => {
    expect((await runSlotExtractionEval()).falseRiskOverrideCount).toBe(0)
  })
})
