import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { getSessionSlots } from '../engines/slotEngine'
import { answerCurrentSlot, returnToPreviousQuestion, skipCurrentSlot, startSession } from '../harness/intakeController'
import { createIntakeSession } from '../harness/sessionState'
import type { AnswerValue, ControllerResult, SlotDefinition } from '../types/intake'

function safeAnswer(slot: SlotDefinition): AnswerValue {
  if (slot.id === 'medicationHistory') return '未采取任何措施'
  if (slot.inputType === 'boolean') return false
  if (slot.inputType === 'number') return 38.2
  if (slot.inputType === 'singleSelect') return slot.options?.[0]?.value ?? '不确定'
  return '昨天'
}

function finish(result: ControllerResult, skipMeasures = false): { result: ControllerResult; asked: string[] } {
  let current = result
  const asked: string[] = []
  while (current.session.status === 'collecting' && current.question) {
    asked.push(current.question.id)
    current = skipMeasures && current.question.id === 'medicationHistory'
      ? skipCurrentSlot(current.session, current.question)
      : answerCurrentSlot(current.session, current.question, safeAnswer(current.question))
  }
  return { result: current, asked }
}

describe('交接摘要必问的已采取措施', () => {
  it.each([
    ['发热', 'fever' as const],
    ['咳嗽', 'cough' as const],
  ])('%s流程在7轮内询问已采取措施', (_name, complaint) => {
    const { result, asked } = finish(startSession({ age: 35, quickComplaint: complaint }))
    expect(asked).toContain('medicationHistory')
    expect(asked.indexOf('medicationHistory')).toBeLessThan(7)
    expect(result.session.turnCount).toBeLessThanOrEqual(7)
  })

  it('明确未采取措施时摘要忠实显示，不列为未获取', () => {
    const { result } = finish(startSession({ age: 35, quickComplaint: 'fever' }))
    expect(result.summary?.measuresTaken).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '已采取措施', displayValue: '未采取任何措施' }),
    ]))
    expect(result.summary?.unansweredInformation).not.toContain('已采取措施')
  })

  it('对已采取措施选择暂不清楚时进入skippedInformation', () => {
    const { result } = finish(startSession({ age: 35, quickComplaint: 'cough' }), true)
    expect(result.summary?.skippedInformation).toContain('已采取措施')
  })
})

describe('问诊导航', () => {
  it('返回上一步恢复上一问题和原答案且不增加轮次', () => {
    const started = startSession({ age: 35, quickComplaint: 'fever' })
    const answered = answerCurrentSlot(started.session, started.question!, false)
    const back = returnToPreviousQuestion(answered.session)
    expect(back.question?.id).toBe(started.question?.id)
    expect(back.session.answers[started.question!.id]).toBe(false)
    expect(back.session.turnCount).toBe(0)
  })

  it('风险升级后不能返回普通问诊', () => {
    const started = startSession({ age: 35, quickComplaint: 'fever' })
    const escalated = answerCurrentSlot(started.session, started.question!, true)
    const back = returnToPreviousQuestion(escalated.session)
    expect(back.session.status).toBe('escalated')
    expect(back.question).toBeNull()
  })

  it('返回后修改前置答案会重新计算并清理子槽位', () => {
    const session = createIntakeSession(35)
    session.status = 'collecting'
    session.chiefComplaints = ['cough']
    session.currentSlotId = 'coughType'
    session.answers = { coughType: 'productive', sputumColor: '黄色' }
    const coughType = getSessionSlots(session).find((slot) => slot.id === 'coughType')!
    const changed = answerCurrentSlot(session, coughType, 'dry')
    expect(changed.session.answers.sputumColor).toBeUndefined()
    expect(changed.session.notApplicableSlotIds).toContain('sputumColor')
  })

  it('返回首页取消时保留会话，确认时清空会话', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App staticDemo />)
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.click(screen.getByRole('button', { name: '返回首页' }))
    expect(confirm).toHaveBeenCalledWith('返回首页将清空本次已填写内容，是否继续？')
    expect(screen.getByRole('heading', { name: '预问诊信息整理' })).toBeInTheDocument()
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: '返回首页' }))
    expect(screen.getByRole('heading', { name: /帮助患者在就医前/u })).toBeInTheDocument()
  })

  it('摘要页可以进入修改信息并以确认返回首页', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App staticDemo />)
    await user.type(screen.getByLabelText('用一句话描述当前不适（可选）'), '昨天开始发烧，现在38.5度')
    await user.click(screen.getByRole('button', { name: '开始整理' }))
    while (!screen.queryByRole('heading', { name: '信息整理摘要' })) {
      const no = screen.queryByRole('button', { name: '否' })
      const continuous = screen.queryByRole('button', { name: '持续' })
      const noMeasures = screen.queryByRole('button', { name: '未采取任何措施' })
      if (no) await user.click(no)
      else if (continuous) await user.click(continuous)
      else if (noMeasures) await user.click(noMeasures)
      else await user.click(screen.getByRole('button', { name: '暂不清楚，跳过' }))
    }
    await user.click(screen.getByRole('button', { name: '修改已填信息' }))
    expect(screen.getByRole('dialog', { name: '查看或修改' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '关闭' }))
    await user.click(screen.getByRole('button', { name: '返回首页' }))
    expect(confirm).toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: '信息整理摘要' })).toBeInTheDocument()
  })

  it('手机端导航使用单列且按钮具有可点击高度', () => {
    const css = readFileSync(resolve('src/styles.css'), 'utf8')
    expect(css).toContain('.intake-navigation { display: grid; grid-template-columns: 1fr; }')
    expect(css).toContain('.intake-navigation button { width: 100%; min-height: 44px; }')
  })
})
