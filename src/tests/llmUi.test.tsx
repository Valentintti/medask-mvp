import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

const enabledStatus = { realLlmEnabled: true, serviceAvailable: true, schemaVersion: '1.1' }

describe('开发模式Mock适配器页面', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('首页提供默认关闭的Mock开关和问题表达模式', () => {
    render(<App />)
    expect(screen.getByLabelText('纯规则')).toBeChecked()
    expect(screen.getByLabelText('Mock LLM')).not.toBeChecked()
    expect(screen.getByLabelText('Real LLM')).toBeDisabled()
    expect(screen.getByLabelText('使用标准问题')).toBeChecked()
    expect(screen.getByLabelText('使用模型改写问题')).not.toBeChecked()
  })

  it('启用Mock后显示自由文本入口并展示已接受候选', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByLabelText('Mock LLM'))
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '我昨天开始发烧')
    await user.click(screen.getByRole('button', { name: '用Mock整理描述' }))
    expect(await screen.findByRole('status')).toHaveTextContent('起病时间：昨天')
    expect(screen.queryByText('0.94')).not.toBeInTheDocument()
  })

  it('低置信或uncertain输出显示固定澄清问题', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByLabelText('Mock LLM'))
    await user.click(screen.getByRole('button', { name: '咳嗽快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '可能有点发烧吧')
    await user.click(screen.getByRole('button', { name: '用Mock整理描述' }))
    expect(await screen.findByText(/请再明确描述“呼吸困难”/u)).toBeInTheDocument()
  })

  it('风险问题保持标准措辞且不交给模型改写', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByLabelText('Mock LLM'))
    await user.click(screen.getByLabelText('使用模型改写问题'))
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    expect(await screen.findByRole('heading', { name: '现在是否有明显呼吸困难、喘不上气或呼吸非常费力？' })).toBeInTheDocument()
    expect(screen.getByText('呼吸困难')).toBeInTheDocument()
    expect(await screen.findByText('risk_blocked')).toBeInTheDocument()
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
    await user.click(screen.getByLabelText('Mock LLM'))
    await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '我昨天开始发烧')
    await user.click(screen.getByRole('button', { name: '用Mock整理描述' }))
    expect(await screen.findByText('slot_extraction')).toBeInTheDocument()
    expect(screen.queryByText('昨天开始')).not.toBeInTheDocument()
  })

  it('服务端启用后Real模式可通过受控网关接受合法自由文本', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/api/llm/status')) return new Response(JSON.stringify(enabledStatus), { status: 200 })
      return new Response(JSON.stringify({ schemaVersion: '1.1', candidates: [{ slotId: 'onset', value: '昨天', confidence: 0.99, evidence: '昨天', status: 'asserted' }], unresolvedSlotIds: [], needsClarification: false }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup(); render(<App />)
    const real = await screen.findByLabelText('Real LLM'); await vi.waitFor(() => expect(real).toBeEnabled())
    await user.click(real); await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '我昨天开始发烧')
    await user.click(screen.getByRole('button', { name: '整理这段描述' }))
    expect(await screen.findByRole('status')).toHaveTextContent('起病时间：昨天')
  })

  it('Real模式风险原文在本地升级且不请求extract端点', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(enabledStatus), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup(); render(<App />)
    const real = await screen.findByLabelText('Real LLM'); await vi.waitFor(() => expect(real).toBeEnabled())
    await user.click(real); await user.click(screen.getByRole('button', { name: '咳嗽快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '我现在喘不上气')
    await user.click(screen.getByRole('button', { name: '整理这段描述' }))
    expect(await screen.findByRole('heading', { name: '请停止普通预问诊' })).toBeInTheDocument()
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/llm/extract'))).toHaveLength(0)
  })

  it('Real服务503后显示固定提示并切换为标准问题模式', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/llm/status')
      ? new Response(JSON.stringify(enabledStatus), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 'real_llm_unavailable' } }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup(); render(<App />)
    const real = await screen.findByLabelText('Real LLM'); await vi.waitFor(() => expect(real).toBeEnabled())
    await user.click(real); await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '普通描述')
    await user.click(screen.getByRole('button', { name: '整理这段描述' }))
    expect(await screen.findByRole('status')).toHaveTextContent('自然语言辅助暂时不可用，已切换为标准问题模式。')
    expect(screen.queryByLabelText('也可以用一句话回答当前问题')).not.toBeInTheDocument()
  })

  it('Real服务429后显示固定提示并切换为标准问题模式', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/api/llm/status')
      ? new Response(JSON.stringify(enabledStatus), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 'rate_limited' } }), { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup(); render(<App />)
    const real = await screen.findByLabelText('Real LLM'); await vi.waitFor(() => expect(real).toBeEnabled())
    await user.click(real); await user.click(screen.getByRole('button', { name: '发热快速入口' }))
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '普通描述')
    await user.click(screen.getByRole('button', { name: '整理这段描述' }))
    expect(await screen.findByRole('status')).toHaveTextContent('自然语言辅助暂时不可用，已切换为标准问题模式。')
    expect(screen.queryByLabelText('也可以用一句话回答当前问题')).not.toBeInTheDocument()
  })
})
