import { describe, expect, it } from 'vitest'
import { detectComplaints, extractInitialAnswers } from '../engines/complaintEngine'
import { getSessionSlots, selectNextSlot } from '../engines/slotEngine'
import { createSummary } from '../engines/summaryEngine'
import { answerCurrentSlot, startSession } from '../harness/intakeController'
import { assertPolicySafe, findPolicyViolations } from '../harness/policyGuard'
import { createIntakeSession } from '../harness/sessionState'
import type { AnswerValue, ControllerResult, IntakeSession, SlotDefinition } from '../types/intake'

function slotFor(session: IntakeSession, slotId: string): SlotDefinition {
  const slot = getSessionSlots(session).find((item) => item.id === slotId)
  if (!slot) throw new Error(`测试槽位不存在：${slotId}`)
  return slot
}

function safeAnswer(slot: SlotDefinition): AnswerValue {
  if (slot.inputType === 'boolean') return false
  if (slot.inputType === 'number') return 38.2
  if (slot.inputType === 'singleSelect') return slot.options?.[0]?.value ?? '不确定'
  return '昨天'
}

function runUntilStopped(result: ControllerResult, maxSteps = 30): ControllerResult {
  let current = result
  let steps = 0
  while (current.session.status === 'collecting' && current.question && steps < maxSteps) {
    current = answerCurrentSlot(current.session, current.question, safeAnswer(current.question))
    steps += 1
  }
  return current
}

describe('主诉识别', () => {
  it('识别“我昨天开始发烧”为 fever', () => {
    expect(detectComplaints('我昨天开始发烧')).toEqual(['fever'])
  })

  it('识别“最近一直咳嗽”为 cough', () => {
    expect(detectComplaints('最近一直咳嗽')).toEqual(['cough'])
  })

  it('同时识别发热和咳嗽', () => {
    expect(detectComplaints('我发热而且一直咳嗽')).toEqual(['fever', 'cough'])
  })

  it('不把局部“胸口发烧”自动识别为体温发热', () => {
    expect(detectComplaints('只是胸口发烧')).toEqual([])
  })

  it('无关文本进入 unsupported', () => {
    const result = startSession({ age: 30, initialText: '我想了解一下健康知识' })
    expect(result.session.status).toBe('unsupported')
  })

  it('18—65岁以外进入 unsupported', () => {
    const result = startSession({ age: 12, initialText: '一直咳嗽' })
    expect(result.session.status).toBe('unsupported')
  })
})

describe('槽位选择', () => {
  it('首句已提供起病时间时不重复追问 onset', () => {
    const result = startSession({ age: 34, initialText: '我昨天开始发烧' })
    expect(result.session.answers.onset).toBe('昨天')
    expect(result.session.askedSlotIds).not.toContain('onset')
  })

  it('无痰时跳过痰液颜色', () => {
    const session = createIntakeSession(30)
    session.status = 'collecting'
    session.chiefComplaints = ['cough']
    session.answers.coughType = 'dry'
    session.askedSlotIds = getSessionSlots(session)
      .map((slot) => slot.id)
      .filter((id) => id !== 'sputumColor')
    const selection = selectNextSlot(session)
    expect(selection.slot).toBeNull()
    expect(selection.notApplicableSlotIds).toContain('sputumColor')
  })

  it('有痰时追问痰液颜色', () => {
    const session = createIntakeSession(30)
    session.status = 'collecting'
    session.chiefComplaints = ['cough']
    session.answers.coughType = 'productive'
    session.askedSlotIds = getSessionSlots(session)
      .map((slot) => slot.id)
      .filter((id) => id !== 'sputumColor')
    const selection = selectNextSlot(session)
    expect(selection.slot?.id).toBe('sputumColor')
  })

  it('已询问槽位不会重复', () => {
    const session = createIntakeSession(30)
    session.status = 'collecting'
    session.chiefComplaints = ['fever']
    session.askedSlotIds = ['breathingDifficulty']
    expect(selectNextSlot(session).slot?.id).not.toBe('breathingDifficulty')
  })

  it('达到7轮后自动完成', () => {
    const final = runUntilStopped(startSession({ age: 30, initialText: '发烧' }))
    expect(final.session.turnCount).toBe(7)
    expect(final.session.status).toBe('completed')
    expect(final.summary).not.toBeNull()
  })

  it('无剩余槽位时自动完成', () => {
    const started = startSession({ age: 30, initialText: '最近咳嗽' })
    started.session.maxTurns = 30
    const final = runUntilStopped(started)
    expect(final.session.status).toBe('completed')
    expect(final.session.turnCount).toBeLessThan(30)
  })

  it('多主诉共享槽位只出现一次', () => {
    const session = createIntakeSession(30)
    session.chiefComplaints = ['fever', 'cough']
    const ids = getSessionSlots(session).map((slot) => slot.id)
    expect(ids.filter((id) => id === 'onset')).toHaveLength(1)
    expect(ids.filter((id) => id === 'breathingDifficulty')).toHaveLength(1)
    expect(ids.filter((id) => id === 'medicationHistory')).toHaveLength(1)
  })

  it('首句信息可以跳过已获得的咳嗽类型', () => {
    const result = startSession({ age: 42, initialText: '最近干咳，没有痰' })
    expect(result.session.answers.coughType).toBe('dry')
    expect(result.session.askedSlotIds).not.toContain('coughType')
  })

  it('昨天高烧且现在已退烧不写入当前体温', () => {
    const answers = extractInitialAnswers('昨天38.5度，现在已退烧', ['fever'])
    expect(answers.currentTemperature).toBeUndefined()
  })

  it('体温最高39度只写入最高体温', () => {
    const answers = extractInitialAnswers('体温最高39度', ['fever'])
    expect(answers.maxTemperature).toBe(39)
    expect(answers.currentTemperature).toBeUndefined()
  })

  it('最高体温和当前体温按各自局部语境提取', () => {
    const answers = extractInitialAnswers('最高39度，现在38.5度', ['fever'])
    expect(answers.maxTemperature).toBe(39)
    expect(answers.currentTemperature).toBe(38.5)
  })

  it('“不是干咳，是有痰”识别为productive', () => {
    const answers = extractInitialAnswers('不是干咳，是有痰', ['cough'])
    expect(answers.coughType).toBe('productive')
  })
})

describe('风险升级', () => {
  it('首句明确胸痛立即触发 escalated', () => {
    const result = startSession({ age: 45, initialText: '我咳嗽而且现在胸痛' })
    expect(result.session.status).toBe('escalated')
    expect(result.session.escalationReason).toContain('胸痛')
  })

  it('明显呼吸困难立即触发 escalated', () => {
    const result = startSession({ age: 45, initialText: '咳嗽而且喘不上气' })
    expect(result.session.status).toBe('escalated')
  })

  it('结构化确认胸痛触发 escalated', () => {
    let result = startSession({ age: 45, initialText: '发烧' })
    expect(result.question?.id).toBe('breathingDifficulty')
    result = answerCurrentSlot(result.session, result.question!, false)
    expect(result.question?.id).toBe('chestPain')
    result = answerCurrentSlot(result.session, result.question!, true)
    expect(result.session.status).toBe('escalated')
  })

  it('升级后不继续普通问诊', () => {
    const escalated = startSession({ age: 40, initialText: '咳嗽并且呼吸非常费力' })
    const fakeSlot = slotFor(
      { ...escalated.session, chiefComplaints: ['cough'] },
      'onset',
    )
    const after = answerCurrentSlot(escalated.session, fakeSlot, '昨天')
    expect(after.session.status).toBe('escalated')
    expect(after.question).toBeNull()
  })

  it('意识不清表达触发 escalated', () => {
    expect(startSession({ age: 50, initialText: '发烧后意识不清' }).session.status).toBe(
      'escalated',
    )
  })
})

describe('摘要、Trace 与政策边界', () => {
  it('摘要不包含疾病诊断', () => {
    const final = runUntilStopped(startSession({ age: 30, initialText: '昨天开始发烧' }))
    const serialized = JSON.stringify(final.summary)
    expect(serialized).not.toMatch(/确诊为|诊断为|你患有/u)
  })

  it('摘要不包含药物推荐', () => {
    const final = runUntilStopped(startSession({ age: 30, initialText: '咳嗽' }))
    expect(JSON.stringify(final.summary)).not.toMatch(/建议服用|处方|剂量/u)
  })

  it('摘要不编造缺失数据', () => {
    const session = createIntakeSession(30)
    session.status = 'completed'
    session.chiefComplaints = ['fever']
    session.answers.onset = '昨天'
    const summary = createSummary(session)
    expect(summary.onset).toEqual([
      { label: '起病时间', value: '昨天', displayValue: '昨天', source: 'user' },
    ])
    expect(summary.currentSymptoms).toEqual([])
    expect(summary.unansweredInformation).toContain('最高体温')
  })

  it('Trace 记录关键状态变化且不写控制台', () => {
    const result = startSession({ age: 40, initialText: '咳嗽并且喘不上气' })
    expect(result.session.traceEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['session_started', 'risk_checked', 'escalated']),
    )
    const escalation = result.session.traceEvents.find((event) => event.eventType === 'escalated')
    expect(escalation?.previousStatus).toBe('collecting')
    expect(escalation?.nextStatus).toBe('escalated')
  })

  it('policyGuard 拦截疾病确诊输出', () => {
    expect(() => assertPolicySafe('你确诊为某疾病')).toThrow(/产品边界/u)
  })

  it('policyGuard 拦截药物和剂量建议', () => {
    expect(findPolicyViolations('建议服用某药，每日两片')).toEqual(
      expect.arrayContaining(['policy.drug_recommendation', 'policy.dosage']),
    )
  })

  it('安全的信息整理声明可以通过 policyGuard', () => {
    expect(() => assertPolicySafe('本摘要仅用于预问诊信息整理，不是诊断结论。')).not.toThrow()
  })
})
