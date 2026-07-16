import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { detectComplaints } from '../engines/complaintEngine'
import { checkTextRisk } from '../engines/riskEngine'
import { getSessionSlots } from '../engines/slotEngine'
import { createSummary } from '../engines/summaryEngine'
import {
  answerCurrentSlot,
  createSafeErrorResult,
  skipCurrentSlot,
  startSession,
} from '../harness/intakeController'
import { assertPolicySafe } from '../harness/policyGuard'
import { createIntakeSession } from '../harness/sessionState'
import App from '../App'
import type { AnswerValue, ControllerResult, IntakeSession, SlotDefinition } from '../types/intake'

function findSlot(session: IntakeSession, id: string): SlotDefinition {
  const slot = getSessionSlots(session).find((candidate) => candidate.id === id)
  if (!slot) throw new Error(`测试槽位不存在：${id}`)
  return slot
}

function safeAnswer(slot: SlotDefinition): AnswerValue {
  if (slot.inputType === 'boolean') return false
  if (slot.inputType === 'number') return 38.5
  if (slot.inputType === 'singleSelect') return slot.options?.[0]?.value ?? '不确定'
  return '昨天'
}

function runToLimit(result: ControllerResult): ControllerResult {
  let current = result
  while (current.session.status === 'collecting' && current.question) {
    current = answerCurrentSlot(current.session, current.question, safeAnswer(current.question))
  }
  return current
}

describe('候选词级否定、转折与复发', () => {
  it.each([
    '没有胸痛',
    '无胸痛',
    '否认胸痛',
    '未出现胸痛',
    '不伴胸痛',
    '没有呼吸困难',
    '不存在呼吸困难',
    '没有晕厥',
  ])('明确否认“%s”不触发风险升级', (text) => {
    expect(checkTextRisk(text).matched).toBe(false)
  })

  it.each(['没有发烧', '不发热', '未出现发热'])('明确否认“%s”不识别为 fever', (text) => {
    expect(detectComplaints(text)).not.toContain('fever')
  })

  it('“没有发烧，只是咳嗽”只识别 cough', () => {
    expect(detectComplaints('没有发烧，只是咳嗽')).toEqual(['cough'])
  })

  it('局部否定后转折出现胸痛仍触发升级', () => {
    const result = startSession({ age: 38, initialText: '没有胸痛，但后来突然胸痛并且咳嗽' })
    expect(result.session.status).toBe('escalated')
    expect(result.session.escalationReason).toContain('胸痛')
  })

  it('退烧后今天再次发烧仍识别 fever', () => {
    expect(detectComplaints('退烧后今天再次发烧')).toContain('fever')
  })
})

describe('用户原文与系统生成内容边界', () => {
  it('用户自述诊断史可以被忠实记录且带明确前缀', () => {
    const started = startSession({
      age: 40,
      quickComplaint: 'fever',
      initialText: '医生诊断为肺炎',
    })
    const summary = createSummary(started.session)
    expect(summary.currentSymptoms[0].value).toBe('医生诊断为肺炎')
    expect(summary.currentSymptoms[0].displayValue).toBe('用户自述：医生诊断为肺炎')
  })

  it('系统生成诊断叙述仍被 policyGuard 拦截', () => {
    expect(() => assertPolicySafe('你诊断为肺炎')).toThrow(/产品边界/u)
  })

  it('用户输入“医生给我开过药”不会导致摘要崩溃', () => {
    const started = startSession({
      age: 40,
      quickComplaint: 'cough',
      initialText: '医生给我开过药',
    })
    expect(() => createSummary(started.session)).not.toThrow()
    expect(createSummary(started.session).currentSymptoms[0].displayValue).toContain('用户自述：')
  })

  it('页面可完成包含诊断史自述的会话而不白屏', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('用一句话描述当前不适（可选）'), '医生诊断为肺炎')
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    for (let turn = 0; turn < 7; turn += 1) {
      await user.click(screen.getByRole('button', { name: '暂不清楚，跳过' }))
    }
    expect(screen.getByRole('heading', { name: '信息整理摘要' })).toBeInTheDocument()
    expect(screen.getByText('用户自述：医生诊断为肺炎')).toBeInTheDocument()
  })
})

describe('缺失信息分类与显示格式', () => {
  it('用户主动跳过的槽位进入 skippedInformation', () => {
    const started = startSession({ age: 30, quickComplaint: 'cough' })
    const skipped = skipCurrentSlot(started.session, started.question!)
    const summary = createSummary(skipped.session)
    expect(summary.skippedInformation).toContain('呼吸困难')
    expect(summary.unansweredInformation).not.toContain('呼吸困难')
  })

  it('达到7轮上限后的未问槽位进入 unansweredInformation', () => {
    const final = runToLimit(startSession({ age: 30, quickComplaint: 'fever' }))
    expect(final.session.turnCount).toBe(7)
    expect(final.summary?.unansweredInformation.length).toBeGreaterThan(0)
  })

  it('showWhen 条件不成立进入 notApplicable 且不算缺失', () => {
    const session = createIntakeSession(30)
    session.status = 'completed'
    session.chiefComplaints = ['cough']
    session.answers.coughType = 'dry'
    const summary = createSummary(session)
    expect(summary.notApplicableInformation).toContain('痰液颜色')
    expect(summary.unansweredInformation).not.toContain('痰液颜色')
    expect(summary.skippedInformation).not.toContain('痰液颜色')
  })

  it('showWhen前置答案未知时仍属于unanswered而非notApplicable', () => {
    const session = createIntakeSession(30)
    session.status = 'completed'
    session.chiefComplaints = ['cough']
    const summary = createSummary(session)
    expect(summary.unansweredInformation).toContain('痰液颜色')
    expect(summary.unansweredInformation).toContain('最高体温')
    expect(summary.notApplicableInformation).not.toContain('痰液颜色')
    expect(summary.notApplicableInformation).not.toContain('最高体温')
  })

  it('singleSelect 的 dry 统一显示为“干咳”', () => {
    const session = createIntakeSession(30)
    session.chiefComplaints = ['cough']
    session.answers.coughType = 'dry'
    const entry = createSummary(session).currentSymptoms.find((item) => item.label === '咳嗽类型')
    expect(entry?.displayValue).toBe('干咳')
  })

  it('体温字段统一带 ℃', () => {
    const session = createIntakeSession(30)
    session.chiefComplaints = ['fever']
    session.answers.currentTemperature = 38.5
    const entry = createSummary(session).currentSymptoms.find((item) => item.label === '当前体温')
    expect(entry?.displayValue).toBe('38.5℃')
  })
})

describe('槽位数值双层校验', () => {
  function temperatureSession(): { session: IntakeSession; slot: SlotDefinition } {
    const session = createIntakeSession(30)
    session.status = 'collecting'
    session.chiefComplaints = ['fever']
    session.currentSlotId = 'currentTemperature'
    session.askedSlotIds = ['currentTemperature']
    return { session, slot: findSlot(session, 'currentTemperature') }
  }

  it.each([999, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    '控制器拒绝非法体温 %s',
    (value) => {
      const { session, slot } = temperatureSession()
      const result = answerCurrentSlot(session, slot, value)
      expect(result.validationError).toBe('请输入30—45℃之间的有效体温。')
      expect(result.session.answers.currentTemperature).toBeUndefined()
    },
  )

  it('非法数字不增加 turnCount', () => {
    const { session, slot } = temperatureSession()
    const result = answerCurrentSlot(session, slot, 999)
    expect(result.session.turnCount).toBe(0)
  })

  it('前端阻止999并显示清晰错误', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.click(screen.getByRole('button', { name: '否' }))
    await user.click(screen.getByRole('button', { name: '否' }))
    await user.type(screen.getByLabelText('起病时间'), '昨天')
    await user.click(screen.getByRole('button', { name: '保存回答' }))
    await user.click(screen.getByRole('button', { name: '持续' }))
    await user.click(screen.getByRole('button', { name: '未采取任何措施' }))
    await user.type(screen.getByLabelText('当前体温'), '999')
    await user.click(screen.getByRole('button', { name: '保存回答' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入30—45℃之间的有效体温。')
    expect(screen.getByLabelText('问诊轮次')).toHaveTextContent('6/ 7 轮')
  })
})

describe('安全错误边界与 Trace', () => {
  it('规则异常显示不含内部详情的安全错误页', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const Boom = () => {
      throw new Error('患者原始文本与 C:\\internal\\path')
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: '本次信息整理暂时无法继续' })).toBeInTheDocument()
    expect(screen.queryByText(/患者原始文本|internal/u)).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('Error Trace 不包含原始患者文本', () => {
    const session = createIntakeSession(30)
    session.initialNarrative = '医生诊断为肺炎，这是原始文本'
    const result = createSafeErrorResult(session)
    const errorEvent = result.session.traceEvents.find((event) => event.eventType === 'error')
    expect(errorEvent).toBeDefined()
    expect(JSON.stringify(errorEvent)).not.toContain('医生诊断为肺炎')
    expect(errorEvent?.input).toEqual({ errorType: 'rule_execution' })
  })
})
