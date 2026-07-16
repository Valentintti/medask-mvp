import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createSummary } from '../engines/summaryEngine'
import { editSessionAnswer, startSession } from '../harness/intakeController'
import { createIntakeSession } from '../harness/sessionState'

describe('近期已缓解的本次发热', () => {
  it('昨天发热且现在退烧仍进入发热整理并记录resolved', () => {
    const result = startSession({ age: 40, initialText: '昨天38.5度，现在已经退烧了' })
    expect(result.session.status).toBe('collecting')
    expect(result.session.chiefComplaints).toContain('fever')
    expect(result.session.feverCurrentStatus).toBe('resolved')
    expect(result.session.answers.currentTemperature).toBeUndefined()
  })

  it('摘要明确本次已缓解且不声称当前仍发热', () => {
    const started = startSession({ age: 40, initialText: '昨天38.5度，现在已经退烧了' })
    const summary = createSummary({ ...started.session, status: 'completed' })
    expect(summary.currentSymptoms.some((item) => item.displayValue === '本次发热目前已缓解')).toBe(true)
    expect(JSON.stringify(summary)).not.toContain('当前仍发热')
  })

  it.each(['去年发过烧，现在没事', '小时候经常发烧'])('%s 不进入本次问诊', (text) => {
    expect(startSession({ age: 40, initialText: text }).session.status).toBe('unsupported')
  })
})

describe('确定性修改已填信息', () => {
  it('修改当前体温后摘要显示新值且不增加轮次', () => {
    const started = startSession({ age: 36, initialText: '昨天开始发烧，现在38.5度' })
    const beforeTurns = started.session.turnCount
    const edited = editSessionAnswer(started.session, 'currentTemperature', 37)
    expect(edited.session.answers.currentTemperature).toBe(37)
    expect(edited.session.turnCount).toBe(beforeTurns)
    expect(createSummary({ ...edited.session, status: 'completed' }).currentSymptoms)
      .toEqual(expect.arrayContaining([expect.objectContaining({ label: '当前体温', displayValue: '37℃' })]))
  })

  it('修改前置槽位后清理已不适用的子槽位答案', () => {
    const session = createIntakeSession(35)
    session.status = 'completed'
    session.chiefComplaints = ['cough']
    session.answers = { coughType: 'productive', sputumColor: '黄色' }
    const edited = editSessionAnswer(session, 'coughType', 'dry')
    expect(edited.session.answers.sputumColor).toBeUndefined()
    expect(edited.session.notApplicableSlotIds).toContain('sputumColor')
    expect(JSON.stringify(edited.summary)).not.toContain('黄色')
  })

  it('非法编辑值被拒绝且不改变原值', () => {
    const session = createIntakeSession(35)
    session.status = 'completed'
    session.chiefComplaints = ['fever']
    session.answers.currentTemperature = 38.5
    const edited = editSessionAnswer(session, 'currentTemperature', 999)
    expect(edited.validationError).toContain('30—45℃')
    expect(edited.session.answers.currentTemperature).toBe(38.5)
  })

  it('编辑风险槽位为是仍立即升级', () => {
    const session = createIntakeSession(45)
    session.status = 'collecting'
    session.chiefComplaints = ['cough']
    session.answers.breathingDifficulty = false
    const edited = editSessionAnswer(session, 'breathingDifficulty', true)
    expect(edited.session.status).toBe('escalated')
  })

  it('页面可修改体温并在完成后的摘要展示新值', async () => {
    const user = userEvent.setup()
    render(<App staticDemo />)
    await user.type(screen.getByLabelText('用一句话描述当前不适（可选）'), '昨天开始发烧，现在38.5度')
    await user.click(screen.getByRole('button', { name: '开始整理' }))
    await user.click(screen.getByRole('button', { name: '查看/修改已填信息' }))
    await user.selectOptions(screen.getByLabelText('选择要修改的项目'), 'currentTemperature')
    const temperature = screen.getByLabelText('修改当前体温')
    await user.clear(temperature)
    await user.type(temperature, '37')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    await user.click(screen.getByRole('button', { name: '关闭' }))
    await user.click(screen.getByRole('button', { name: '否' }))
    await user.click(screen.getByRole('button', { name: '否' }))
    await user.click(screen.getByRole('button', { name: '持续' }))
    await user.click(screen.getByRole('button', { name: '暂不清楚，跳过' }))
    await user.click(screen.getByRole('button', { name: '暂不清楚，跳过' }))
    await user.click(screen.getByRole('button', { name: '暂不清楚，跳过' }))
    await user.click(screen.getByRole('button', { name: '暂不清楚，跳过' }))
    expect(screen.getByRole('heading', { name: '信息整理摘要' })).toBeInTheDocument()
    expect(screen.getByText('37℃')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回修改' })).toBeInTheDocument()
  })
})

describe('长文本反馈和用户文案', () => {
  it('初始描述显示计数且浏览器限制为500字符', async () => {
    render(<App staticDemo />)
    const input = screen.getByLabelText('用一句话描述当前不适（可选）')
    expect(input).toHaveAttribute('maxLength', '500')
    fireEvent.change(input, { target: { value: '发'.repeat(501) } })
    expect(input).toHaveValue('发'.repeat(500))
    expect(screen.getByText('500 / 500')).toBeInTheDocument()
    expect(screen.getByText(/接近字符上限/u)).toBeInTheDocument()
  })

  it('不支持页面使用中文范围文案且静态模式不请求API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<App staticDemo />)
    await user.type(screen.getByLabelText('用一句话描述当前不适（可选）'), '我肚子疼')
    await user.click(screen.getByRole('button', { name: '开始整理' }))
    expect(screen.getByText('当前不在支持范围')).toBeInTheDocument()
    expect(screen.queryByText('OUT OF DEMO SCOPE')).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
