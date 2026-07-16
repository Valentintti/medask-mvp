import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from '../App'

describe('开发模式Mock适配器页面', () => {
  it('首页提供默认关闭的Mock开关和问题表达模式', () => {
    render(<App />)
    expect(screen.getByLabelText('启用Mock自然语言理解')).not.toBeChecked()
    expect(screen.getByLabelText('使用标准问题')).toBeChecked()
    expect(screen.getByLabelText('使用模型改写问题')).not.toBeChecked()
  })

  it('启用Mock后显示自由文本入口并展示已接受候选', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByLabelText('启用Mock自然语言理解'))
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '我昨天开始发烧')
    await user.click(screen.getByRole('button', { name: '用Mock整理描述' }))
    expect(await screen.findByRole('status')).toHaveTextContent('起病时间：昨天')
    expect(screen.queryByText('0.94')).not.toBeInTheDocument()
  })

  it('低置信或uncertain输出显示固定澄清问题', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByLabelText('启用Mock自然语言理解'))
    await user.click(screen.getByRole('button', { name: '咳嗽快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '可能有点发烧吧')
    await user.click(screen.getByRole('button', { name: '用Mock整理描述' }))
    expect(await screen.findByText(/请再明确描述“呼吸困难”/u)).toBeInTheDocument()
  })

  it('模型改写模式只替换显示问题，不改变当前槽位', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByLabelText('使用模型改写问题'))
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    expect(await screen.findByRole('heading', { name: '现在有没有明显呼吸困难？' })).toBeInTheDocument()
    expect(screen.getByText('呼吸困难')).toBeInTheDocument()
  })

  it('标准问题模式保持原始canonicalQuestion', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    expect(
      screen.getByRole('heading', { name: '现在是否有明显呼吸困难、喘不上气或呼吸非常费力？' }),
    ).toBeInTheDocument()
  })

  it('开发Trace只显示模型调用元数据', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByLabelText('启用Mock自然语言理解'))
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '我昨天开始发烧')
    await user.click(screen.getByRole('button', { name: '用Mock整理描述' }))
    expect(await screen.findByText('slot_extraction')).toBeInTheDocument()
    expect(screen.queryByText('昨天开始')).not.toBeInTheDocument()
  })
})
