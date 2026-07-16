import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSlotExtractionPrompt, SLOT_EXTRACTION_SYSTEM_PROMPT } from '../../server/prompts/slotExtractionPrompt'
import { enforceTrustedExtractionScope, SERVER_COMPLAINT_IDS } from '../../server/rules/serverSlotRules'
import { complaintRules } from '../data/complaintRules'
import { getSessionSlots } from '../engines/slotEngine'
import { answerFreeText, startSession } from '../harness/intakeController'
import { createIntakeSession } from '../harness/sessionState'
import { HttpLlmProvider } from '../llm/httpProvider'
import { v2RealProviderCases, v2RealProviderGate2CaseIds, v2RealProviderSmokeCaseIds } from '../llm/evals/v2RealProviderCases'
import { MockLlmProvider } from '../llm/mockProvider'
import { SlotExtractionAdapter } from '../llm/slotExtractionAdapter'
import { LLM_SCHEMA_VERSION, type CandidateStatus, type SlotCandidate, type SlotExtractionRequest } from '../llm/types'

const response = (candidates: SlotCandidate[]) => ({
  schemaVersion: LLM_SCHEMA_VERSION,
  candidates,
  unresolvedSlotIds: [],
  needsClarification: false,
})

function candidate(status: CandidateStatus, evidence: string): SlotCandidate {
  return { slotId: 'headacheSensation', value: '胀痛', confidence: 0.99, evidence, status }
}

function headacheInput(userText: string): Parameters<SlotExtractionAdapter['extract']>[0] {
  const session = createIntakeSession(30)
  session.status = 'collecting'
  session.chiefComplaints = ['headache']
  session.currentSlotId = 'headacheSensation'
  return {
    supportedComplaints: ['headache'],
    allowedSlots: getSessionSlots(session),
    currentQuestionSlotId: 'headacheSensation',
    userText,
    existingAnswers: {},
  }
}

describe('V2真实Provider冻结评测集', () => {
  it('正式集为50条且每类25条', () => {
    expect(v2RealProviderCases).toHaveLength(50)
    expect(v2RealProviderCases.filter((item) => item.complaint === 'headache')).toHaveLength(25)
    expect(v2RealProviderCases.filter((item) => item.complaint === 'dizziness')).toHaveLength(25)
  })

  it('5条冒烟案例都来自正式集', () => {
    const ids = new Set(v2RealProviderCases.map((item) => item.id))
    expect(v2RealProviderSmokeCaseIds).toHaveLength(5)
    expect(v2RealProviderSmokeCaseIds.every((id) => ids.has(id))).toBe(true)
  })

  it('第二关固定20条且两类各10条并覆盖分层类别', () => {
    expect(v2RealProviderGate2CaseIds).toHaveLength(20)
    const selected = v2RealProviderCases.filter((item) => v2RealProviderGate2CaseIds.includes(item.id as typeof v2RealProviderGate2CaseIds[number]))
    expect(selected.filter((item) => item.complaint === 'headache')).toHaveLength(10)
    expect(selected.filter((item) => item.complaint === 'dizziness')).toHaveLength(10)
    for (const category of ['current_affirmed', 'negated', 'historical', 'resolved', 'hypothetical', 'ambiguous', 'multi_complaint', 'risk_expression', 'slot_conflict']) {
      expect(selected.some((item) => item.category === category)).toBe(true)
    }
    expect(selected.some((item) => item.adversarialKind === 'evidence_truncation')).toBe(true)
    expect(selected.some((item) => item.adversarialKind === 'illegal_output_inducement')).toBe(true)
  })

  it('覆盖要求的语境、风险、冲突和两类对抗诱导', () => {
    const categories = new Set(v2RealProviderCases.map((item) => item.category))
    for (const category of ['current_affirmed', 'negated', 'historical', 'resolved', 'hypothetical', 'ambiguous', 'multi_complaint', 'risk_expression', 'slot_conflict']) {
      expect(categories).toContain(category)
    }
    expect(new Set(v2RealProviderCases.map((item) => item.adversarialKind).filter(Boolean))).toEqual(
      new Set(['evidence_truncation', 'illegal_output_inducement']),
    )
  })

  it('全部期望槽位都属于实验评测主诉的规则定义', () => {
    for (const item of v2RealProviderCases) {
      const evaluationSlots = new Set(item.complaints.flatMap((complaint) => complaintRules[complaint].slots.map((slot) => slot.id)))
      expect(item.expected.every((entry) => evaluationSlots.has(entry.slotId))).toBe(true)
    }
  })
})

describe('V2真实Provider Prompt与服务端范围', () => {
  it('生产Prompt保持通用安全约束且不包含未放行主诉的定向调参', () => {
    expect(SLOT_EXTRACTION_SYSTEM_PROMPT).toMatch(/不得诊断疾病|evidence 必须/u)
    const prompt = buildSlotExtractionPrompt({
      supportedComplaints: ['headache', 'dizziness'],
      allowedSlotIds: ['headacheLocation', 'dizzinessExperience'],
      currentQuestionSlotId: null,
      userText: '合成文本',
      existingSlotIds: [],
      locale: 'zh-CN',
      schemaVersion: LLM_SCHEMA_VERSION,
    })
    expect(prompt).not.toMatch(/allowedSlotGuidance|headacheLocation.*temple|dizzinessExperience.*spinning/u)
  })

  it('生产Prompt不附加固定评测案例专用槽位指导', () => {
    const prompt = buildSlotExtractionPrompt({
      supportedComplaints: ['headache'],
      allowedSlotIds: ['headacheLocation'],
      currentQuestionSlotId: null,
      userText: '合成文本',
      existingSlotIds: [],
      locale: 'zh-CN',
      schemaVersion: LLM_SCHEMA_VERSION,
    })
    const parsed = JSON.parse(prompt) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('allowedSlotGuidance')
    expect(parsed).not.toHaveProperty('promptVersion')
  })

  it('规则定义保留头痛头晕，但真实Provider生产白名单只放行发热咳嗽', () => {
    expect(complaintRules.headache.slots.some((slot) => slot.id === 'headacheLocation')).toBe(true)
    expect(complaintRules.dizziness.slots.some((slot) => slot.id === 'dizzinessExperience')).toBe(true)
    expect([...SERVER_COMPLAINT_IDS]).toEqual(['fever', 'cough'])
  })

  it('生产服务端拒绝未放行的头痛与头晕提取请求', () => {
    const base: SlotExtractionRequest = {
      supportedComplaints: ['headache'],
      allowedSlotIds: ['headacheLocation'],
      currentQuestionSlotId: null,
      userText: '合成文本',
      existingSlotIds: [],
      locale: 'zh-CN',
      schemaVersion: LLM_SCHEMA_VERSION,
    }
    expect(() => enforceTrustedExtractionScope(base)).toThrow('complaint_not_enabled_for_real_provider')
    expect(() => enforceTrustedExtractionScope({ ...base, supportedComplaints: ['dizziness'], allowedSlotIds: ['dizzinessExperience'] })).toThrow('complaint_not_enabled_for_real_provider')
  })
})

describe('V2真实Provider接受策略与回退', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('风险文本在网关调用前被拦截', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const started = startSession({ age: 30, initialText: '突然开始剧烈头痛' })
    expect(started.session.status).toBe('escalated')
    const result = await answerFreeText(started.session, '继续', new SlotExtractionAdapter(new HttpLlmProvider()))
    expect(result.session.status).toBe('escalated')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['negated', '没有头痛', '没有头痛', 'candidate_negated'],
    ['historical', '以前头痛是胀痛', '以前头痛是胀痛', 'historical_context'],
    ['resolved', '头痛的胀痛已经缓解', '头痛的胀痛已经缓解', 'resolved_context'],
  ] as const)('%s候选不写入当前答案', async (status, userText, evidence, reason) => {
    const provider = new MockLlmProvider({ responses: { [userText]: response([candidate(status, evidence)]) } })
    const result = await new SlotExtractionAdapter(provider).extract(headacheInput(userText))
    expect(result.acceptedCandidates).toHaveLength(0)
    expect(result.rejectedCandidates[0].reason).toBe(reason)
  })

  it('evidence不在原文时拒绝', async () => {
    const userText = '头痛有点胀'
    const provider = new MockLlmProvider({ responses: { [userText]: response([candidate('asserted', '原文不存在')]) } })
    const result = await new SlotExtractionAdapter(provider).extract(headacheInput(userText))
    expect(result.acceptedCandidates).toHaveLength(0)
    expect(result.rejectedCandidates[0].reason).toBe('evidence_hallucinated')
  })

  it('Provider失败时保持答案并继续规则问题', async () => {
    const started = startSession({ age: 30, initialText: '现在头痛' })
    const provider = new MockLlmProvider({ throwInputs: ['自然语言失败'] })
    const before = { ...started.session.answers }
    const result = await answerFreeText(started.session, '自然语言失败', new SlotExtractionAdapter(provider))
    expect(result.session.answers).toEqual(before)
    expect(result.session.status).toBe('collecting')
    expect(result.question).not.toBeNull()
    expect(result.extractionNotice).toContain('标准问题')
  })
})
