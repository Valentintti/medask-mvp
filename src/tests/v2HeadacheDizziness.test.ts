import { describe, expect, it } from 'vitest'
import { complaintRules } from '../data/complaintRules'
import { detectComplaintCurrentStatus, detectComplaints } from '../engines/complaintEngine'
import { checkTextRisk } from '../engines/riskEngine'
import { getSessionSlots, reconcileConditionalSlots } from '../engines/slotEngine'
import { createSummary } from '../engines/summaryEngine'
import { evaluateV2ComplaintCases } from '../evals/evaluateV2Complaints'
import {
  answerCurrentSlot,
  answerFreeText,
  editSessionAnswer,
  skipCurrentSlot,
  startSession,
  startSessionWithAdapter,
} from '../harness/intakeController'
import { createIntakeSession } from '../harness/sessionState'
import { MockLlmProvider } from '../llm/mockProvider'
import { SlotExtractionAdapter } from '../llm/slotExtractionAdapter'
import { LLM_SCHEMA_VERSION } from '../llm/types'
import { sanitizeExtractRequest } from '../../server/security/requestSanitizer'
import type { AnswerValue, ComplaintId, ControllerResult, SlotDefinition } from '../types/intake'

function safeAnswer(slot: SlotDefinition): AnswerValue {
  if (slot.inputType === 'boolean') return false
  if (slot.inputType === 'number') return 37.2
  if (slot.inputType === 'singleSelect') return slot.options?.[0]?.value ?? 'uncertain'
  return slot.id === 'medicationHistory' ? '已经休息并记录情况' : '用户自述信息'
}

function finishFlow(result: ControllerResult): ControllerResult {
  let current = result
  while (current.session.status === 'collecting' && current.question) {
    current = answerCurrentSlot(current.session, current.question, safeAnswer(current.question))
  }
  return current
}

describe('V2 头痛与头晕主诉识别', () => {
  it.each([
    ['当前头痛', '今天开始头痛', 'headache'],
    ['当前头晕', '现在有点头晕', 'dizziness'],
    ['口语头痛', '太阳穴一阵一阵疼', 'headache'],
    ['口语头晕', '站起来以后晕乎乎', 'dizziness'],
  ])('%s可识别', (_name, text, complaint) => {
    expect(detectComplaints(text)).toContain(complaint)
  })

  it.each([
    ['没有头痛', 'headache'],
    ['否认头晕', 'dizziness'],
    ['去年经常头痛', 'headache'],
    ['如果以后头晕怎么办', 'dizziness'],
  ])('%s不进入当前主诉', (text, complaint) => {
    expect(detectComplaints(text)).not.toContain(complaint)
  })

  it.each([
    ['头痛已经好了', 'headache'],
    ['头晕已经缓解', 'dizziness'],
  ])('%s进入本次整理并标记 resolved', (text, complaint) => {
    expect(detectComplaints(text)).toContain(complaint)
    expect(detectComplaintCurrentStatus(text, complaint as ComplaintId)).toBe('resolved')
  })

  it.each(['只是头皮疼', '头上长了包'])('%s不误识别为头痛', (text) => {
    expect(detectComplaints(text)).not.toContain('headache')
  })

  it.each(['我只是晕车', '喝醉后站不稳', '只是困倦', '只是眼花'])('%s不误识别为头晕', (text) => {
    expect(detectComplaints(text)).not.toContain('dizziness')
  })
})

describe('V2 风险规则先于 Provider', () => {
  it.each([
    ['突然开始剧烈头痛', 'risk.headache.sudden_severe'],
    ['头痛时说话突然含糊', 'risk.neurologic.sudden_speech_with_head_symptom'],
    ['突然头痛，左手抬不起来', 'risk.neurologic.sudden_unilateral_deficit'],
    ['摔到头以后头痛越来越重', 'risk.headache.after_severe_head_injury'],
    ['突然头晕，说话含糊', 'risk.neurologic.sudden_speech_with_head_symptom'],
    ['我刚刚突然晕倒', 'risk.consciousness.altered'],
    ['头晕同时胸口很痛', 'risk.dizziness.with_chest_pain'],
    ['头晕并且喘不上气', 'risk.dizziness.with_severe_breathing'],
  ])('%s触发固定风险中断', (text, ruleId) => {
    const risk = checkTextRisk(text)
    expect(risk.matched).toBe(true)
    expect(risk.ruleId).toBe(ruleId)
  })

  it('风险首句不调用 Mock Provider', async () => {
    const provider = new MockLlmProvider()
    const result = await startSessionWithAdapter(
      { age: 30, initialText: '突然开始剧烈头痛' },
      new SlotExtractionAdapter(provider),
    )
    expect(result.session.status).toBe('escalated')
    expect(provider.extractionCallCount).toBe(0)
  })

  it('风险升级后不能返回普通流程', async () => {
    const provider = new MockLlmProvider()
    const adapter = new SlotExtractionAdapter(provider)
    const escalated = startSession({ age: 30, initialText: '头晕后突然晕倒' })
    const result = await answerFreeText(escalated.session, '现在好一点', adapter)
    expect(result.session.status).toBe('escalated')
    expect(provider.extractionCallCount).toBe(0)
  })

  it.each([
    '没有突然剧烈头痛',
    '去年有过突然剧烈头痛',
    '如果突然剧烈头痛怎么办',
    '头痛已经缓解，没有意识异常',
    '只是有点疼',
  ])('否定、历史、假设、已缓解或模糊表达不升级：%s', (text) => {
    expect(checkTextRisk(text).matched).toBe(false)
  })
})

describe('V2 槽位、轮次和多主诉去重', () => {
  it.each([
    ['headache', '头痛'],
    ['dizziness', '头晕'],
  ] as const)('%s 在7轮内完成且询问已采取措施', (complaint, text) => {
    const final = finishFlow(startSession({ age: 30, initialText: text }))
    expect(final.session.status).toBe('completed')
    expect(final.session.turnCount).toBeLessThanOrEqual(7)
    expect(final.session.askedSlotIds).toContain('medicationHistory')
    expect(final.session.chiefComplaints).toContain(complaint)
  })

  it.each([
    [['headache', 'dizziness']],
    [['fever', 'cough', 'headache', 'dizziness']],
  ] as Array<[ComplaintId[]]>)('多主诉共享 onset 和 medicationHistory 各只有一次：%j', (complaints) => {
    const session = createIntakeSession(30)
    session.chiefComplaints = complaints
    const ids = getSessionSlots(session).map((slot) => slot.id)
    expect(ids.filter((id) => id === 'onset')).toHaveLength(1)
    expect(ids.filter((id) => id === 'medicationHistory')).toHaveLength(1)
  })

  it('头痛和头晕合并后仍最多7轮', () => {
    const final = finishFlow(startSession({ age: 30, initialText: '现在头痛也头晕' }))
    expect(final.session.status).toBe('completed')
    expect(final.session.turnCount).toBe(7)
  })

  it('首句头痛信息不会重复询问已提取槽位', () => {
    const result = startSession({ age: 30, initialText: '昨天开始太阳穴一阵一阵疼' })
    expect(result.session.answers).toMatchObject({ onset: '昨天', headacheLocation: 'temple', headachePattern: 'intermittent' })
    expect(result.session.askedSlotIds).not.toContain('onset')
    expect(result.session.askedSlotIds).not.toContain('headacheLocation')
  })

  it('首句头晕信息不会重复询问已提取槽位', () => {
    const result = startSession({ age: 30, initialText: '今天站起来会发晕，感觉天旋地转' })
    expect(result.session.answers).toMatchObject({ onset: '今天', dizzinessTrigger: 'standing_up', dizzinessExperience: 'spinning' })
    expect(result.session.askedSlotIds).not.toContain('onset')
    expect(result.session.askedSlotIds).not.toContain('dizzinessExperience')
  })
})

describe('V2 摘要、跳过与编辑', () => {
  it('内部枚举在摘要中显示为中文', () => {
    const session = createIntakeSession(30)
    session.status = 'completed'
    session.chiefComplaints = ['headache']
    session.answers.headacheLocation = 'temple'
    const summary = createSummary(session)
    expect(summary.currentSymptoms[0].displayValue).toBe('太阳穴')
    expect(summary.currentSymptoms.map((entry) => entry.displayValue)).not.toContain('temple')
  })

  it.each([
    ['头痛已经好了', '头痛'],
    ['头晕已经缓解', '头晕'],
  ])('%s只展示在本次已缓解', (text, displayName) => {
    const result = startSession({ age: 30, initialText: text })
    const summary = createSummary(result.session)
    expect(summary.resolvedSymptoms.some((entry) => entry.displayValue.includes(displayName))).toBe(true)
    expect(summary.currentSymptoms.some((entry) => entry.value === text)).toBe(false)
  })

  it('用户跳过的信息归入用户暂不清楚', () => {
    const result = startSession({ age: 30, quickComplaint: 'headache' })
    const skipped = skipCurrentSlot(result.session, result.question!)
    expect(createSummary(skipped.session).skippedInformation).toContain(result.question!.label)
  })

  it('条件不成立的信息归入条件不适用', () => {
    const session = createIntakeSession(30)
    session.status = 'collecting'
    session.chiefComplaints = ['cough']
    session.answers.coughType = 'dry'
    const reconciled = reconcileConditionalSlots(session)
    expect(createSummary(reconciled).notApplicableInformation).toContain('痰液颜色')
  })

  it('摘要不补写疾病、概率或建议', () => {
    const session = createIntakeSession(30)
    session.status = 'completed'
    session.chiefComplaints = ['dizziness']
    session.answers.dizzinessExperience = 'spinning'
    const rendered = JSON.stringify(createSummary(session))
    expect(rendered).not.toMatch(/诊断为|患病概率|建议服用|治疗方案/u)
  })

  it('修改已填枚举后摘要同步更新且不增加轮次', () => {
    const session = createIntakeSession(30)
    session.status = 'completed'
    session.chiefComplaints = ['headache']
    session.answers.headacheLocation = 'forehead'
    session.turnCount = 4
    const edited = editSessionAnswer(session, 'headacheLocation', 'occipital')
    expect(edited.session.turnCount).toBe(4)
    expect(edited.summary?.currentSymptoms.find((entry) => entry.label === '头痛位置')?.displayValue).toBe('后脑勺')
  })
})

describe('V2 Mock Provider 与合成评测', () => {
  it.each([
    ['昨天开始头痛', 'onset'],
    ['太阳穴一阵阵疼', 'headacheLocation'],
    ['没有头痛', 'headacheSensation'],
    ['头痛已经好了', 'headachePattern'],
    ['今天开始天旋地转', 'dizzinessExperience'],
    ['站起来会发晕', 'dizzinessTrigger'],
    ['走路有点不稳', 'balanceImpact'],
    ['没有头晕', 'dizzinessExperience'],
    ['头晕已经缓解', 'dizzinessPattern'],
  ])('Mock 对“%s”返回预期候选 %s', async (userText, slotId) => {
    const provider = new MockLlmProvider()
    const raw = await provider.extractSlots({
      supportedComplaints: ['headache', 'dizziness'],
      allowedSlotIds: ['onset', 'headacheLocation', 'headacheSensation', 'headachePattern', 'dizzinessExperience', 'dizzinessTrigger', 'balanceImpact', 'dizzinessPattern'],
      currentQuestionSlotId: null,
      userText,
      existingSlotIds: [],
      locale: 'zh-CN',
      schemaVersion: LLM_SCHEMA_VERSION,
    })
    expect(raw).toMatchObject({ candidates: expect.arrayContaining([expect.objectContaining({ slotId })]) })
  })

  it('132条结构完整，其中66条进入可执行评测', async () => {
    const report = await evaluateV2ComplaintCases()
    expect(report.structure).toMatchObject({ totalCases: 132, targetExecutableCases: 66, designOnlyCases: 66 })
    expect(report.structure.perComplaint).toEqual({ headache: 33, dizziness: 33, abdominal_pain: 33, chest_discomfort: 33 })
  })

  it('合成工程评测达到门槛且零错误计数', async () => {
    const report = await evaluateV2ComplaintCases()
    expect(report.passed).toBe(true)
    expect(report.complaintRecognitionAccuracy.rate).toBeGreaterThanOrEqual(0.9)
    expect(report.currentnessRecognitionAccuracy.rate).toBeGreaterThanOrEqual(0.9)
    expect(report.riskPreemptionRate.rate).toBe(1)
    expect([
      report.negationFalseTriggers,
      report.historicalMiswrites,
      report.resolvedWrittenAsCurrent,
      report.sharedSlotDuplicates,
      report.summaryFabrications,
    ]).toEqual([0, 0, 0, 0, 0])
  })

  it('规则版保留头痛头晕，但真实Provider生产白名单不放行', () => {
    expect(complaintRules.headache.slots.some((slot) => slot.id === 'headacheLocation')).toBe(true)
    expect(complaintRules.dizziness.slots.some((slot) => slot.id === 'dizzinessExperience')).toBe(true)
    expect(() => sanitizeExtractRequest(JSON.stringify({
      supportedComplaints: ['headache', 'dizziness'],
      allowedSlotIds: ['headacheLocation', 'dizzinessExperience'],
      currentQuestionSlotId: 'headacheLocation',
      userText: '太阳穴疼，同时有点头晕',
      existingSlotIds: [],
      locale: 'zh-CN',
      schemaVersion: LLM_SCHEMA_VERSION,
    }))).toThrow('request_values_invalid')
  })

  it('服务端白名单仍拒绝腹痛和胸部不适主诉', () => {
    expect(() => sanitizeExtractRequest(JSON.stringify({
      supportedComplaints: ['abdominal_pain', 'chest_discomfort'],
      allowedSlotIds: ['onset'],
      currentQuestionSlotId: 'onset',
      userText: '人工合成文本',
      existingSlotIds: [],
      locale: 'zh-CN',
      schemaVersion: LLM_SCHEMA_VERSION,
    }))).toThrow('request_values_invalid')
  })
})
