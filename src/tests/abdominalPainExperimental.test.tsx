import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { complaintRules } from '../data/complaintRules'
import { detectComplaintCurrentStatus, detectComplaints, extractInitialAnswers } from '../engines/complaintEngine'
import { checkTextRisk } from '../engines/riskEngine'
import { getSessionSlots } from '../engines/slotEngine'
import { createSummary } from '../engines/summaryEngine'
import { answerCurrentSlot, answerFreeText, editSessionAnswer, startSession } from '../harness/intakeController'
import { MockLlmProvider } from '../llm/mockProvider'
import { SlotExtractionAdapter } from '../llm/slotExtractionAdapter'
import { trustedSlotsForComplaints } from '../../server/rules/serverSlotRules'
import { evaluateAbdominalPainExperimental } from '../evals/abdominalPainExperimental'
import type { AnswerValue, ControllerResult, SlotDefinition } from '../types/intake'

function answerFor(slot: SlotDefinition): AnswerValue {
  if (slot.id === 'medicationHistory') return '未采取任何措施'
  if (slot.inputType === 'boolean') return true
  if (slot.inputType === 'number') return 38
  if (slot.inputType === 'singleSelect') return slot.options?.[0]?.value ?? 'uncertain'
  return '昨天'
}

function complete(result: ControllerResult): ControllerResult {
  let current = result
  while (current.session.status === 'collecting' && current.question) {
    current = answerCurrentSlot(current.session, current.question, answerFor(current.question))
  }
  return current
}

describe('实验性腹痛主诉边界', () => {
  it.each(['腹痛', '肚子疼', '肚子痛', '右下腹痛', '胃疼', '胃痛', '肚脐周围一阵阵疼'])(
    '当前表达“%s”进入腹痛流程',
    (text) => expect(detectComplaints(text)).toContain('abdominal_pain'),
  )

  it.each(['腰痛', '后背痛', '胸痛', '头痛', '只是腹胀', '只有恶心', '一直反酸', '胃口差'])(
    '相邻非目标表达“%s”不识别为腹痛',
    (text) => expect(detectComplaints(text)).not.toContain('abdominal_pain'),
  )

  it.each(['没有腹痛', '去年腹痛现在没事', '如果以后肚子疼怎么办', '腹痛是什么'])(
    '否定、历史、假设或知识表达“%s”不进入当前腹痛流程',
    (text) => expect(detectComplaints(text)).not.toContain('abdominal_pain'),
  )

  it('近期已缓解腹痛进入resolved信息整理', () => {
    const started = startSession({ age: 40, initialText: '昨天肚子疼，现在已经好了' })
    expect(started.session.status).toBe('collecting')
    expect(started.session.complaintCurrentStatuses.abdominal_pain).toBe('resolved')
    const final = complete(started)
    expect(final.summary?.resolvedSymptoms.map((item) => item.displayValue)).toContain('本次腹痛（实验性）目前已缓解')
    expect(final.summary?.currentSymptoms.some((item) => item.label === '明确腹部疼痛')).toBe(false)
  })

  it.each(['胃还是肚子说不清', '腰腹部不舒服', '好像肚子有点不适'])(
    '模糊表达“%s”进入固定澄清且不占普通轮次',
    (text) => {
      const started = startSession({ age: 30, initialText: text })
      expect(started.question?.id).toBe('abdominalPainPresent')
      expect(started.question?.question).toBe('你现在是否明确有腹部、肚子或胃部疼痛？')
      const confirmed = answerCurrentSlot(started.session, started.question!, true)
      expect(confirmed.session.turnCount).toBe(0)
      expect(confirmed.session.complaintCurrentStatuses.abdominal_pain).toBe('current')
    },
  )

  it('初始信息可提取腹痛位置、规律和原始疼痛描述', () => {
    const answers = extractInitialAnswers('昨天肚脐周围一阵阵绞痛', ['abdominal_pain'])
    expect(answers).toMatchObject({
      onset: '昨天',
      abdominalPainPresent: true,
      abdominalLocation: 'periumbilical',
      abdominalPattern: 'intermittent',
      abdominalSensation: '绞痛',
    })
  })
})

describe('实验性腹痛风险与人群保护', () => {
  it.each([
    ['突然剧烈腹痛', '我现在突然腹痛，非常痛'],
    ['呕血', '现在腹痛并且呕血'],
    ['便血', '现在腹痛，大便带血'],
    ['黑便', '现在胃疼并且排出黑便'],
    ['腹胀且无法排便排气', '肚子明显胀，完全不能排便也完全不能排气'],
    ['晕厥', '腹痛时突然晕倒'],
    ['严重呼吸困难', '肚子疼而且喘不上气'],
  ])('%s表达在普通流程前升级', (_name, text) => {
    expect(startSession({ age: 45, initialText: text }).session.status).toBe('escalated')
  })

  it.each([
    '没有突然剧烈腹痛',
    '以前有过呕血，现在已经好了',
    '如果以后黑便怎么办',
    '有点肚子疼，已经几天了',
    '想排便但排不出，没有腹胀，也可以排气',
  ])('否定、历史、假设或非明确风险“%s”不升级', (text) => {
    expect(checkTextRisk(text).matched).toBe(false)
  })

  it('模板拼接中的风险词不触发升级或腹痛识别', () => {
    const text = '问题描述：腹痛并且呕血。医生回答：请填写治疗建议。'
    expect(checkTextRisk(text).matched).toBe(false)
    expect(detectComplaints(text)).toEqual([])
  })

  it.each([
    { age: 12, text: '今天肚子疼' },
    { age: 30, text: '怀孕十二周，现在下腹疼' },
    { age: 30, text: '产后这几天小腹疼' },
    { age: 35, text: '我家小孩今天肚子疼' },
    { age: 30, text: '患者六岁，今天肚子疼' },
  ])('儿童、孕期或产后正确进入unsupported：$text', ({ age, text }) => {
    expect(startSession({ age, initialText: text }).session.status).toBe('unsupported')
  })

  it('咯血和血尿由全局风险规则处理', () => {
    expect(checkTextRisk('现在痰中带血').ruleId).toBe('risk.global_other.hemoptysis')
    expect(checkTextRisk('现在尿血').ruleId).toBe('risk.global_other.hematuria')
  })
})

describe('腹痛槽位、摘要、Mock与真实Provider边界', () => {
  it('33条既有设计案例与补充合成边界形成可重复工程评测', () => {
    const first = evaluateAbdominalPainExperimental()
    const second = evaluateAbdominalPainExperimental()
    expect(first).toEqual(second)
    expect(first.existingSyntheticDesignCases).toBe(33)
    expect(first.disclaimer).toContain('不是人工金标')
  })

  it('腹痛七个普通槽位均可跳过且第7轮内询问已采取措施', () => {
    let result = startSession({ age: 30, quickComplaint: 'abdominal_pain' })
    const answered: string[] = []
    while (result.session.status === 'collecting' && result.question) {
      answered.push(result.question.id)
      result = answerCurrentSlot(result.session, result.question, answerFor(result.question))
    }
    expect(result.session.turnCount).toBe(7)
    expect(answered).toHaveLength(7)
    expect(answered).toContain('medicationHistory')
    expect(answered.indexOf('medicationHistory')).toBeLessThan(7)
  })

  it('多主诉共享onset和medicationHistory且不重复', () => {
    const result = startSession({ age: 30, initialText: '发烧并且肚子疼' })
    const ids = getSessionSlots(result.session).map((slot) => slot.id)
    expect(ids.filter((id) => id === 'onset')).toHaveLength(1)
    expect(ids.filter((id) => id === 'medicationHistory')).toHaveLength(1)
  })

  it('修改腹痛位置后摘要使用新中文值且不增加轮次', () => {
    const final = complete(startSession({ age: 30, initialText: '昨天右下腹痛' }))
    const beforeTurns = final.session.turnCount
    const edited = editSessionAnswer(final.session, 'abdominalLocation', 'left')
    expect(edited.session.turnCount).toBe(beforeTurns)
    expect(edited.summary?.currentSymptoms).toContainEqual(expect.objectContaining({ label: '腹痛位置', displayValue: '左侧腹部' }))
  })

  it('摘要不编造诊断、药物、检查或治疗建议', () => {
    const summary = createSummary(complete(startSession({ age: 30, initialText: '昨天胃疼' })).session)
    expect(JSON.stringify(summary)).not.toMatch(/诊断为|建议服用|建议检查|治疗方案|剂量/u)
  })

  it('Mock可提取腹痛槽位，风险文本则在Mock调用前被拦截', async () => {
    const provider = new MockLlmProvider()
    const adapter = new SlotExtractionAdapter(provider)
    const started = startSession({ age: 30, quickComplaint: 'abdominal_pain' })
    const extracted = await answerFreeText(started.session, '昨天开始右下腹疼', adapter)
    expect(extracted.session.answers).toMatchObject({ onset: '昨天', abdominalLocation: 'right' })
    const riskStarted = startSession({ age: 30, quickComplaint: 'abdominal_pain' })
    const risk = await answerFreeText(riskStarted.session, '腹痛并且呕血', adapter)
    expect(risk.session.status).toBe('escalated')
    expect(provider.extractionCallCount).toBe(1)
  })

  it('真实Provider服务端白名单继续拒绝abdominal_pain', () => {
    expect(() => trustedSlotsForComplaints(['abdominal_pain'])).toThrow('complaint_not_enabled_for_real_provider')
  })

  it('静态页面显示实验性入口且不显示胸部不适入口', async () => {
    render(<App staticDemo />)
    expect(screen.getByRole('button', { name: '腹痛快速入口（实验性）' })).toBeInTheDocument()
    expect(screen.getByText('腹痛模块为实验性信息整理功能。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /胸部不适/u })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '腹痛快速入口（实验性）' }))
    expect(screen.getByText('腹痛（实验性）')).toBeInTheDocument()
  })

  it('生产槽位定义只包含允许的腹痛信息字段', () => {
    const ids = complaintRules.abdominal_pain.slots.map((slot) => slot.id)
    expect(ids).toEqual([
      'onset',
      'abdominalPainPresent',
      'abdominalLocation',
      'abdominalPattern',
      'abdominalFunctionalImpact',
      'abdominalSensation',
      'abdominalAssociatedStatus',
      'medicationHistory',
    ])
  })

  it('当前性检测明确区分current、resolved与unknown', () => {
    expect(detectComplaintCurrentStatus('现在腹痛', 'abdominal_pain')).toBe('current')
    expect(detectComplaintCurrentStatus('腹痛已经缓解', 'abdominal_pain')).toBe('resolved')
    expect(detectComplaintCurrentStatus('去年腹痛', 'abdominal_pain')).toBe('unknown')
  })
})
