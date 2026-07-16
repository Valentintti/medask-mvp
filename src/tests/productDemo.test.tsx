import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { FreeTextAnswer } from '../components/FreeTextAnswer'
import { SummaryPage } from '../pages/SummaryPage'
import { clearProductEvents, getProductEvents, recordProductEvent } from '../harness/productEventLogger'
import type { IntakeSummary } from '../types/intake'

const summary: IntakeSummary = {
  patientType: '18—65岁成人（30岁）',
  chiefComplaints: ['发热'],
  onset: [{ label: '起病时间', value: '昨天', displayValue: '昨天', source: 'user' }],
  currentSymptoms: [],
  resolvedSymptoms: [],
  associatedSymptoms: [],
  measuresTaken: [],
  unansweredInformation: ['最高体温'],
  skippedInformation: ['畏寒或寒战'],
  notApplicableInformation: [],
  escalated: false,
  escalationReason: null,
  disclaimer: '本摘要仅用于预问诊信息整理，不是诊断结论。',
}

describe('产品化页面与演示能力', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    clearProductEvents()
  })

  it('首页展示产品定位、范围和明确边界', () => {
    render(<App />)
    expect(screen.getByText('MedAsk')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /帮助患者在就医前/u })).toBeInTheDocument()
    expect(screen.getByText(/当前支持 18—65 岁成人的发热、咳嗽、头痛和头晕/u)).toBeInTheDocument()
    expect(screen.getByText('当前使用标准规则模式')).toBeInTheDocument()
  })

  it.each([
    ['普通发热', '30', '昨天开始发烧，现在38.5度，没有胸痛，也没有呼吸困难'],
    ['咳嗽多槽位', '35', '咳了三天，主要是有痰，痰是黄色的，晚上更明显'],
    ['风险中断', '45', '我现在咳嗽，而且喘不上气'],
  ])('合成案例“%s”只填充而不自动提交', async (name, age, text) => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name }))
    expect(screen.getByLabelText('年龄')).toHaveValue(Number(age))
    expect(screen.getByLabelText('用一句话描述当前不适（可选）')).toHaveValue(text)
    expect(screen.getByRole('heading', { name: /帮助患者在就医前/u })).toBeInTheDocument()
  })

  it('自由文本提交期间显示加载且阻止重复请求', async () => {
    let release: (() => void) | undefined
    const onSubmit = vi.fn(() => new Promise<void>((resolvePromise) => { release = resolvePromise }))
    const user = userEvent.setup()
    render(<FreeTextAnswer busy={false} mode="real" onSubmit={onSubmit} />)
    await user.type(screen.getByLabelText('也可以用一句话回答当前问题'), '合成描述')
    await user.dblClick(screen.getByRole('button', { name: '整理这段描述' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => { release?.() })
  })

  it('摘要支持复制与浏览器打印', async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    render(<SummaryPage summary={summary} onHome={() => undefined} />)
    await user.click(screen.getByRole('button', { name: '复制摘要' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('起病时间：昨天')))
    await user.click(screen.getByRole('button', { name: '打印或保存为 PDF' }))
    expect(print).toHaveBeenCalledTimes(1)
  })

  it('产品事件对象只允许非敏感元数据', () => {
    recordProductEvent('session_started')
    const event = getProductEvents()[0]
    expect(Object.keys(event).sort()).toEqual(['eventType', 'timestamp'])
    expect(JSON.stringify(event)).not.toMatch(/userText|answer|age|evidence|apiKey|raw/u)
  })

  it('生产隐藏条件和Docker敏感文件排除已配置', () => {
    const welcome = readFileSync(resolve('src/pages/WelcomePage.tsx'), 'utf8')
    const app = readFileSync(resolve('src/App.tsx'), 'utf8')
    const dockerIgnore = readFileSync(resolve('.dockerignore'), 'utf8')
    expect(welcome).toContain('(import.meta.env.DEV || staticDemo) && <section className="demo-cases"')
    expect(welcome).toContain('import.meta.env.DEV && !staticDemo && <fieldset className="dev-controls"')
    expect(app).toContain('import.meta.env.DEV && !staticDemo && result')
    expect(dockerIgnore).toMatch(/^\.env$/mu)
    expect(dockerIgnore).toMatch(/^\*\.log$/mu)
  })
})
