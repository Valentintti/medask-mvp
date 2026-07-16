import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('患者端基础流程', () => {
  it('欢迎页明确展示安全边界和两个快速入口', () => {
    render(<App />)
    expect(screen.getByText('本工具只进行信息整理，不提供疾病诊断、用药或治疗建议。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发热快速入口' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '咳嗽快速入口' })).toBeInTheDocument()
  })

  it('可以用一句话进入多主诉问诊', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('用一句话描述当前不适（可选）'), '我昨天开始发烧并且咳嗽')
    await user.click(screen.getByRole('button', { name: '开始整理' }))
    expect(screen.getByText('发热')).toBeInTheDocument()
    expect(screen.getByText('咳嗽')).toBeInTheDocument()
    expect(screen.getByLabelText('问诊轮次')).toHaveTextContent('1')
  })

  it('无关文本显示 unsupported，不伪装成自然语言理解', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('用一句话描述当前不适（可选）'), '我想咨询一件别的事情')
    await user.click(screen.getByRole('button', { name: '开始整理' }))
    expect(screen.getByRole('heading', { name: '当前规则无法继续' })).toBeInTheDocument()
    expect(screen.getByText(/当前演示仅支持发热、咳嗽、头痛和头晕/u)).toBeInTheDocument()
  })

  it('结构化确认胸痛后切换到升级提示页', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.click(screen.getByRole('button', { name: '否' }))
    expect(screen.getByRole('heading', { name: '现在是否有明确胸痛？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '是' }))
    expect(screen.getByRole('heading', { name: '请停止普通预问诊' })).toBeInTheDocument()
    expect(screen.getByText('本提示不代表任何疾病判断。')).toBeInTheDocument()
    expect(screen.queryByText('这些不适大约从什么时候开始？')).not.toBeInTheDocument()
  })

  it('咳嗽流程最多7轮并可完整到达摘要页', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '咳嗽快速入口' }))

    await user.click(screen.getByRole('button', { name: '否' }))

    await user.type(screen.getByLabelText('起病时间'), '昨天')
    await user.click(screen.getByRole('button', { name: '保存回答' }))

    await user.click(screen.getByRole('button', { name: '干咳' }))

    await user.type(screen.getByLabelText('咳嗽持续时间'), '两天')
    await user.click(screen.getByRole('button', { name: '保存回答' }))

    await user.click(screen.getByRole('button', { name: '否' }))
    await user.click(screen.getByRole('button', { name: '未采取任何措施' }))
    await user.click(screen.getByRole('button', { name: '否' }))

    expect(screen.getByRole('heading', { name: '信息整理摘要' })).toBeInTheDocument()
    expect(screen.getByText('18—65岁成人（30岁）')).toBeInTheDocument()
    expect(screen.getByText('本摘要仅用于预问诊信息整理，不是诊断结论。')).toBeInTheDocument()
    expect(screen.queryByText(/建议服用|治疗方案/u)).not.toBeInTheDocument()
  })

  it('开发模式 Trace 面板可见并显示规则事件', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '咳嗽快速入口' }))
    expect(screen.getByText('开发模式 Trace（仅当前会话）')).toBeInTheDocument()
    expect(screen.getByText('session_started')).toBeInTheDocument()
    expect(screen.getByText('complaint_matched')).toBeInTheDocument()
  })
})
