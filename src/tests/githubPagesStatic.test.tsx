import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

describe('GitHub Pages 纯前端规则演示', () => {
  afterEach(() => vi.restoreAllMocks())

  it('静态模式不请求任何 /api 端点', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<App staticDemo />)
    await vi.waitFor(() => expect(screen.getByText('当前使用标准规则模式')).toBeInTheDocument())
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '普通发热' })).toBeInTheDocument()
    expect(screen.queryByText('自然语言辅助模式')).not.toBeInTheDocument()
  })

  it('静态模式可完成发热规则问诊', async () => {
    const user = userEvent.setup()
    render(<App staticDemo />)
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.click(screen.getByRole('button', { name: '否' }))
    await user.click(screen.getByRole('button', { name: '否' }))
    await user.type(screen.getByLabelText('起病时间'), '昨天')
    await user.click(screen.getByRole('button', { name: '保存回答' }))
    await user.click(screen.getByRole('button', { name: '持续' }))
    await user.click(screen.getByRole('button', { name: '未采取任何措施' }))
    await user.click(screen.getByRole('button', { name: '暂不清楚，跳过' }))
    await user.click(screen.getByRole('button', { name: '暂不清楚，跳过' }))
    expect(screen.getByRole('heading', { name: '信息整理摘要' })).toBeInTheDocument()
  })

  it('静态模式可完成咳嗽规则问诊', async () => {
    const user = userEvent.setup()
    render(<App staticDemo />)
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
  })

  it('静态模式的风险原文仍在本地立即中断', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    render(<App staticDemo />)
    await user.type(screen.getByLabelText('用一句话描述当前不适（可选）'), '我现在咳嗽，而且喘不上气')
    await user.click(screen.getByRole('button', { name: '开始整理' }))
    expect(screen.getByRole('heading', { name: '请停止普通预问诊' })).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('配置使用 Pages 子路径并且 Workflow 不需要模型密钥', () => {
    const viteConfig = readFileSync(resolve('vite.config.ts'), 'utf8')
    const workflow = readFileSync(resolve('.github/workflows/deploy-pages.yml'), 'utf8')
    expect(viteConfig).toContain("staticDemo ? '/medask-mvp/' : '/'")
    expect(workflow).toContain("VITE_STATIC_DEMO: 'true'")
    expect(workflow).not.toMatch(/LLM_API_KEY|api\.deepseek\.com/u)
  })
})
