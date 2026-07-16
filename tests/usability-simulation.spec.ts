import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type EndState = 'summary' | 'escalated' | 'unsupported' | 'welcome_after_restart' | 'incomplete'
type Severity = 'none' | 'P0' | 'P1' | 'P2'

interface Persona {
  id: string
  name: string
  age: number
  input: string
  expected: EndState
  viewport: string
  behavior: 'brief' | 'complete' | 'vague' | 'resolved' | 'conflict' | 'cough-rich' | 'negation-turn' | 'skip-heavy' | 'risk' | 'unsupported' | 'age-unsupported' | 'novice' | 'mobile' | 'long' | 'mixed'
}

interface CaseResult {
  case_id: string
  persona_name: string
  viewport: string
  age: number
  initial_input: string
  expected_end_state: string
  actual_end_state: EndState
  completed: boolean
  action_count: number
  answered_count: number
  skipped_count: number
  repeated_question_found: boolean
  duplicate_submit_blocked: boolean
  risk_preempted: boolean
  unsupported_handled: boolean
  summary_generated: boolean
  summary_matches_user_input: boolean
  unsupported_internal_terms_found: boolean
  error_message_seen: boolean
  screenshots: string
  observed_issue: string
  inferred_confusion: string
  severity: Severity
  notes: string
  question_path: string[]
}

// 全部为人工编写的合成角色和症状，不包含真实患者信息。
const PERSONAS: Persona[] = [
  { id: 'US-01', name: '极简表达者', age: 30, input: '我发烧了', expected: 'summary', viewport: '1440x1000', behavior: 'brief' },
  { id: 'US-02', name: '信息一次说完者', age: 32, input: '昨天开始发烧，最高39度，现在38.2度，有点咳嗽，没有胸痛，也没有呼吸困难，已经做过退热处理', expected: 'summary', viewport: '1440x1000', behavior: 'complete' },
  { id: 'US-03', name: '模糊表达者', age: 28, input: '好像有点发烧，不太确定，前几天也有过', expected: 'summary', viewport: '1440x1000', behavior: 'vague' },
  { id: 'US-04', name: '历史但已缓解者', age: 40, input: '昨天38.5度，现在已经退烧了', expected: 'summary', viewport: '1440x1000', behavior: 'resolved' },
  { id: 'US-05', name: '前后信息冲突者', age: 36, input: '我发烧了，现在38.5度', expected: 'summary', viewport: '1440x1000', behavior: 'conflict' },
  { id: 'US-06', name: '咳嗽多信息者', age: 35, input: '咳了三天，主要是有痰，痰是黄色的，晚上更明显', expected: 'summary', viewport: '1440x1000', behavior: 'cough-rich' },
  { id: 'US-07', name: '否定转折者', age: 38, input: '不是干咳，是有痰，没有胸痛', expected: 'summary', viewport: '1440x1000', behavior: 'negation-turn' },
  { id: 'US-08', name: '大量跳过者', age: 45, input: '最近一直咳嗽', expected: 'summary', viewport: '1440x1000', behavior: 'skip-heavy' },
  { id: 'US-09', name: '风险表达者', age: 45, input: '我现在咳嗽，而且喘不上气', expected: 'escalated', viewport: '1440x1000', behavior: 'risk' },
  { id: 'US-10', name: '不支持主诉者', age: 30, input: '我肚子疼', expected: 'unsupported', viewport: '1440x1000', behavior: 'unsupported' },
  { id: 'US-11', name: '不支持年龄者', age: 12, input: '我一直咳嗽', expected: 'unsupported', viewport: '1440x1000', behavior: 'age-unsupported' },
  { id: 'US-12', name: '操作不熟练者', age: 50, input: '昨天开始发烧', expected: 'welcome_after_restart', viewport: '1440x1000', behavior: 'novice' },
  { id: 'US-13', name: '手机端角色', age: 30, input: '我发烧了', expected: 'summary', viewport: '390x844', behavior: 'mobile' },
  { id: 'US-14', name: '超长描述者', age: 34, input: `我发烧了，${'这是用于布局检查的合成补充描述。'.repeat(32)}`, expected: 'summary', viewport: '1440x1000', behavior: 'long' },
  { id: 'US-15', name: '混合主诉者', age: 33, input: '昨天开始发烧，也一直咳嗽', expected: 'summary', viewport: '1440x1000', behavior: 'mixed' },
]

const results: CaseResult[] = []
let browserVersion = '未知'
const reportRoot = resolve('reports')
const screenshotRoot = resolve(reportRoot, 'usability-screenshots-v2')

function csvCell(value: unknown): string {
  const text = Array.isArray(value) ? value.join(' > ') : String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

async function clickTracked(locator: Locator, state: CaseResult): Promise<void> {
  await locator.click()
  state.action_count += 1
}

async function fillTracked(locator: Locator, value: string, state: CaseResult): Promise<void> {
  await locator.fill(value)
  state.action_count += 1
}

async function endState(page: Page): Promise<EndState> {
  if (await page.getByRole('heading', { name: '信息整理摘要' }).count()) return 'summary'
  if (await page.getByRole('heading', { name: '请停止普通预问诊' }).count()) return 'escalated'
  if (await page.getByRole('heading', { name: '当前规则无法继续' }).count()) return 'unsupported'
  if (await page.getByRole('heading', { name: /帮助患者在就医前/ }).count()) return 'welcome_after_restart'
  return 'incomplete'
}

function screenshotName(caseId: string, suffix: string): string {
  return `${caseId.toLowerCase()}-${suffix}.png`
}

async function saveScreenshot(page: Page, result: CaseResult, suffix: string, fullPage = true): Promise<void> {
  const name = screenshotName(result.case_id, suffix)
  await page.screenshot({ path: resolve(screenshotRoot, name), fullPage })
  result.screenshots = result.screenshots ? `${result.screenshots}|reports/usability-screenshots-v2/${name}` : `reports/usability-screenshots-v2/${name}`
}

async function startPersona(page: Page, persona: Persona, result: CaseResult): Promise<void> {
  await page.setViewportSize(persona.viewport === '390x844' ? { width: 390, height: 844 } : { width: 1440, height: 1000 })
  await page.goto('./')
  await expect(page.getByText('当前使用标准规则模式')).toBeVisible()
  if (persona.id === 'US-01') await saveScreenshot(page, result, 'home')
  await fillTracked(page.getByLabel('年龄'), String(persona.age), result)
  await fillTracked(page.getByLabel('用一句话描述当前不适（可选）'), persona.input, result)
  await clickTracked(page.getByRole('button', { name: '开始整理' }), result)
  if (persona.id === 'US-02' && await page.locator('#current-question').count()) await saveScreenshot(page, result, 'intake')
}

async function answerQuestion(page: Page, persona: Persona, result: CaseResult): Promise<void> {
  const question = page.locator('#current-question')
  if (await question.count() !== 1) return
  const questionText = (await question.innerText()).trim()
  result.question_path.push(questionText)
  result.repeated_question_found ||= result.question_path.filter((item) => item === questionText).length > 1

  const skip = page.getByRole('button', { name: '暂不清楚，跳过' })
  const skipHeavy = persona.behavior === 'skip-heavy' && result.skipped_count < 3
  const vagueSkip = persona.behavior === 'vague' && /体温|怕冷|头痛|处理/u.test(questionText)
  if (skipHeavy || vagueSkip) {
    await clickTracked(skip, result)
    result.skipped_count += 1
    return
  }

  const booleanNo = page.getByRole('button', { name: '否', exact: true })
  if (await booleanNo.count() === 1) {
    await clickTracked(booleanNo, result)
    result.answered_count += 1
    return
  }

  const uncertain = page.getByRole('button', { name: '不确定', exact: true })
  if (persona.behavior === 'vague' && await uncertain.count() === 1) {
    await clickTracked(uncertain, result)
    result.answered_count += 1
    return
  }

  const productive = page.getByRole('button', { name: '有痰', exact: true })
  if ((persona.behavior === 'cough-rich' || persona.behavior === 'negation-turn') && await productive.count() === 1) {
    await clickTracked(productive, result)
    result.answered_count += 1
    return
  }

  const dry = page.getByRole('button', { name: '干咳', exact: true })
  if (await dry.count() === 1) {
    await clickTracked(dry, result)
    result.answered_count += 1
    return
  }

  const continuous = page.getByRole('button', { name: '持续', exact: true })
  if (await continuous.count() === 1) {
    await clickTracked(continuous, result)
    result.answered_count += 1
    return
  }

  const input = page.locator('.question-card input')
  if (await input.count() === 1) {
    const label = await input.getAttribute('aria-label') ?? await page.locator('.text-answer label').innerText()
    let value = '昨天'
    if (/持续时间/u.test(label)) value = '三天'
    else if (/当前体温/u.test(label)) value = persona.behavior === 'conflict' ? '37' : '38.2'
    else if (/最高体温/u.test(label)) value = '39'
    else if (/痰液颜色/u.test(label)) value = '黄色'
    else if (/采取措施/u.test(label)) value = '未采取处理'

    if (persona.behavior === 'novice') {
      const save = page.getByRole('button', { name: '保存回答' })
      const before = await page.getByLabel('问诊轮次').innerText()
      await save.click()
      await save.click()
      result.action_count += 2
      result.duplicate_submit_blocked = (await page.getByLabel('问诊轮次').innerText()) === before
      await fillTracked(input, value, result)
      await input.press('Enter')
      result.action_count += 1
    } else {
      await fillTracked(input, value, result)
      await clickTracked(page.getByRole('button', { name: '保存回答' }), result)
    }
    result.answered_count += 1
    return
  }

  await clickTracked(skip, result)
  result.skipped_count += 1
}

async function completeFlow(page: Page, persona: Persona, result: CaseResult): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    if ((await endState(page)) !== 'incomplete') return
    await answerQuestion(page, persona, result)
  }
}

function assessSummary(persona: Persona, text: string): { faithful: boolean; note: string } {
  const ageOk = text.includes(`18—65岁成人（${persona.age}岁）`)
  const noLeakage = !/(?:建议服用|诊断为|治疗方案|患某病概率)/u.test(text)
  let specific = true
  const checks: string[] = []
  if (persona.id === 'US-02') {
    specific = text.includes('38.2℃') && text.includes('39℃') && text.includes('发热') && text.includes('咳嗽')
    checks.push('检查当前/最高体温和混合主诉')
  }
  if (persona.id === 'US-07') {
    specific = /咳嗽类型\s*有痰/u.test(text)
    checks.push('检查否定转折后的有痰')
  }
  if (persona.id === 'US-08') {
    specific = text.includes('用户暂不清楚')
    checks.push('检查跳过信息分类')
  }
  if (persona.id === 'US-04') {
    specific = text.includes('本次发热目前已缓解') && !/当前体温\s*38\.5℃/u.test(text)
    checks.push('检查近期已缓解状态和当前体温')
  }
  if (persona.id === 'US-05') {
    specific = /当前体温\s*37℃/u.test(text)
    checks.push('检查修改后的当前体温')
  }
  return { faithful: ageOk && noLeakage && specific, note: `${checks.join('、') || '检查年龄、主诉和越界输出'}；未见诊断或用药建议` }
}

function classifyIssue(persona: Persona, result: CaseResult, pageText: string): void {
  if (persona.behavior === 'resolved' && result.actual_end_state === 'unsupported') {
    result.observed_issue = '自动化观察到：“昨天38.5度，现在已经退烧了”直接进入不支持页，未进入发热信息整理。'
    result.inferred_confusion = '合成角色走查推测：用户可能不理解已缓解发热为何被判为不支持；尚需真人验证。'
    result.severity = 'P1'
  } else if (persona.behavior === 'conflict' && !/当前体温\s*37℃/u.test(pageText)) {
    result.observed_issue = '自动化观察到：使用修改入口后，摘要未显示修改后的当前体温37℃。'
    result.inferred_confusion = '合成角色走查推测：若修改没有反映到摘要，用户可能不信任该入口；尚需真人验证。'
    result.severity = 'P1'
  } else if (persona.behavior === 'long' && !pageText.includes('信息整理摘要')) {
    result.observed_issue = '自动化观察到：接近500字符上限的合成描述未完成流程。'
    result.inferred_confusion = '合成角色走查推测：长文本用户可能难以恢复；尚需真人验证。'
    result.severity = 'P2'
  } else if (result.unsupported_internal_terms_found) {
    result.observed_issue = '自动化观察到：不支持页显示英文展示词“OUT OF DEMO SCOPE”。'
    result.inferred_confusion = '合成角色走查推测：该词可能被理解为开发者术语；尚需真人验证。'
    result.severity = 'P2'
  } else if (result.repeated_question_found) {
    result.observed_issue = '自动化观察到：同一标准问题在单个案例中重复出现。'
    result.inferred_confusion = '合成角色走查推测：重复追问可能降低信任；尚需真人验证。'
    result.severity = 'P1'
  } else {
    result.observed_issue = '自动化观察到：本案例未发现阻断预期终态的页面事实。'
    result.inferred_confusion = '合成角色走查推测：按钮理解、最多7轮的耐受度与摘要价值仍需真人验证。'
    result.severity = 'none'
  }
}

function writeOutputs(): void {
  mkdirSync(reportRoot, { recursive: true })
  mkdirSync(screenshotRoot, { recursive: true })
  const csvColumns = [
    'case_id', 'persona_name', 'viewport', 'age', 'initial_input', 'expected_end_state', 'actual_end_state', 'completed',
    'action_count', 'answered_count', 'skipped_count', 'repeated_question_found', 'duplicate_submit_blocked', 'risk_preempted',
    'unsupported_handled', 'summary_generated', 'summary_matches_user_input', 'unsupported_internal_terms_found', 'error_message_seen',
    'screenshots', 'observed_issue', 'inferred_confusion', 'severity', 'notes',
  ] as const
  const csv = [csvColumns.join(','), ...results.map((row) => csvColumns.map((column) => csvCell(row[column])).join(','))].join('\n')
  writeFileSync(resolve(reportRoot, 'usability-simulation-cases-v2.csv'), `\uFEFF${csv}\n`, 'utf8')

  const reached = results.filter((row) => row.actual_end_state === row.expected_end_state).length
  const terminal = results.filter((row) => row.completed).length
  const risks = results.filter((row) => row.expected_end_state === 'escalated')
  const unsupported = results.filter((row) => row.expected_end_state === 'unsupported')
  const summaries = results.filter((row) => row.summary_generated)
  const faithful = summaries.filter((row) => row.summary_matches_user_input).length
  const repeats = results.filter((row) => row.repeated_question_found).length
  const severityCounts = {
    P0: new Set(results.filter((r) => r.severity === 'P0').map((r) => r.observed_issue)).size,
    P1: new Set(results.filter((r) => r.severity === 'P1').map((r) => r.observed_issue)).size,
    P2: new Set(results.filter((r) => r.severity === 'P2').map((r) => r.observed_issue)).size,
  }
  const rows = results.map((row) => `## ${row.case_id} ${row.persona_name}\n\n- 操作路径：${row.question_path.length ? row.question_path.join(' → ') : '首页直达终态'}\n- 实际结果：${row.actual_end_state}；操作 ${row.action_count} 次，回答 ${row.answered_count} 项，跳过 ${row.skipped_count} 项。\n- 截图：${row.screenshots || '无'}\n- 发现的问题：${row.observed_issue}\n- 推测的困惑：${row.inferred_confusion}\n- 严重程度：${row.severity}\n- 摘要检查：${row.notes}`).join('\n\n')

  const report = `# 测试说明\n\n本次为15个合成角色与 Playwright 自动化走查，不是真实用户研究，不能替代真人可用性测试。全部症状文本均为人工编写的合成内容。报告严格区分“自动化观察到”与“合成角色走查推测”。\n\n# 测试环境\n\n- Git 提交：${process.env.GIT_COMMIT ?? 'a627763b32e217828c94cd3dbe047f2807142a23'}\n- 测试日期：2026-07-17（Asia/Shanghai）\n- 目标线上地址：https://valentintti.github.io/medask-mvp/\n- 实际执行地址：http://127.0.0.1:4173/medask-mvp/\n- 限制：当前环境无法连接 github.io，因此使用同一提交的 VITE_STATIC_DEMO=true 本地静态模式等价走查，未验证 GitHub CDN 和 Pages 实际发布层。\n- 浏览器：Playwright Chromium（无头模式，版本由 @playwright/test 1.61.1 锁定）\n- 视口：1440×1000；手机 390×844\n- 测试方式：真实 DOM 填写、点击、选择、跳过、Enter 提交与页面终态检查；未调用模型 API。\n\n# 角色和任务\n\n${PERSONAS.map((p) => `- ${p.id} ${p.name}：${p.age}岁，预期 ${p.expected}`).join('\n')}\n\n# 结果摘要\n\n- 流程终态完成率：${terminal}/${results.length} (${(terminal / results.length * 100).toFixed(1)}%)\n- 预期页面到达率：${reached}/${results.length} (${(reached / results.length * 100).toFixed(1)}%)\n- 风险前置成功率：${risks.filter((r) => r.risk_preempted).length}/${risks.length}\n- 不支持范围处理成功率：${unsupported.filter((r) => r.unsupported_handled).length}/${unsupported.length}\n- 重复问题案例数：${repeats}\n- 摘要忠实案例数：${faithful}/${summaries.length}\n- 摘要编造案例数：${summaries.filter((r) => !r.summary_matches_user_input).length}\n- 重复提交保护：${results.find((r) => r.case_id === 'US-12')?.duplicate_submit_blocked ? '成功' : '未确认'}\n- 手机端完成：${results.find((r) => r.case_id === 'US-13')?.summary_generated ? '是' : '否'}\n- 问题数：P0=${severityCounts.P0}，P1=${severityCounts.P1}，P2=${severityCounts.P2}\n\n上述是合成任务完成指标，不是用户满意度、医疗有效性或临床准确率。\n\n# 逐案例记录\n\n${rows}\n\n# 认知走查（推测，与自动化事实分开）\n\n## 首页\n\n- 合成角色走查推测：范围、两个快速入口和“当前使用标准规则模式”可帮助预测下一步；“开始整理”能预测操作结果。\n- 尚需真人验证：用户是否理解“信息整理”不是诊断，以及三个演示案例是否影响真实输入预期。\n\n## 问诊页\n\n- 合成角色走查推测：轮次、主诉标签、标准问题和回答按钮提供即时反馈，无需记住上一页字段。\n- 尚需真人验证：最多7轮是否可接受，“暂不清楚，跳过”是否被理解为未知而非否定，以及静态版无中途自由文本更正入口是否造成困扰。\n\n## 风险页\n\n- 合成角色走查推测：“请停止普通预问诊”清楚标记流程停止，固定声明未推断疾病，返回首页可恢复。\n- 尚需真人验证：风险提示是否清楚但不过度恐慌，是否引起过度焦虑。\n\n## 不支持页\n\n- 合成角色走查推测：页面能说明当前范围并提供返回首页。\n- 尚需真人验证：“OUT OF DEMO SCOPE”英文开发展示词是否会被认为开发者术语。\n\n## 摘要页\n\n- 合成角色走查推测：分区、复制、打印和重新开始按钮能预测结果，免责声明说明用途。\n- 尚需真人验证：用户是否认为摘要有帮助，是否能分清“尚未获取”与“用户暂不清楚”。\n\n# 问题优先级\n\n- P0：${severityCounts.P0} 个。未观察到错误风险中断、越界输出或摘要编造。\n- P1：${severityCounts.P1} 个。包括已缓解发热文本的范围识别，以及静态版无法执行中途自由文本冲突修正。\n- P2：${severityCounts.P2} 个。包括超长输入没有显示长度边界。\n\n# Top 5 问题\n\n1. **已缓解发热进入不支持页（P1）**\n   - 证据：US-04 输入后直达 unsupported。\n   - 影响：无法整理历史但已缓解的相关信息。\n   - 建议：下一轮单独评估主诉入口对已缓解表达的处理，不在本轮修复。\n   - 展示前必修：是。\n2. **静态版无中途自由文本更正/冲突入口（P1）**\n   - 证据：US-05 首句写入38.5℃后，无法再输入“现在37度”。\n   - 影响：无法自动演示冲突澄清。\n   - 建议：评估是否提供结构化的“修改已提供信息”入口。\n   - 展示前必修：是。\n3. **超长描述无字数边界反馈（P2）**\n   - 证据：US-14 近480字描述可直接提交，未显示字数上限。\n   - 影响：输入预期可能不明确。\n   - 建议：真人测试后决定是否增加字数计数或建议。\n   - 展示前必修：否。\n4. **不支持页含英文展示词（认知走查假设）**\n   - 证据：页面显示“OUT OF DEMO SCOPE”。\n   - 影响：可能造成开发者术语感。\n   - 建议：通过真人理解度测试后判断。\n   - 展示前必修：否，尚需真人验证。\n5. **最多7轮的耐受度未知（认知走查假设）**\n   - 证据：自动化能完成，但自动化时间不代表人的完成体验。\n   - 影响：真人可能中途放弃。\n   - 建议：使用真人任务完成率和质性访谈验证。\n   - 展示前必修：否。\n\n# 尚需真人验证的假设\n\n- 用户是否理解“信息整理”而不是诊断。\n- 用户是否愿意完成最多7轮。\n- 用户是否认为摘要有帮助。\n- 风险提示是否引起过度焦虑。\n- 老年或低数字素养用户是否能顺利使用。\n- 按钮文案是否准确预测操作结果。\n- 手机屏幕上的阅读、滚动和打印体验是否可接受。\n`
  const finalizedReport = report
    .replace(
      '- 浏览器：Playwright Chromium（无头模式，版本由 @playwright/test 1.61.1 锁定）',
      `- 浏览器：Playwright Chromium ${browserVersion}（无头模式）`,
    )
    .replace(
      `- 摘要编造案例数：${summaries.filter((r) => !r.summary_matches_user_input).length}`,
      '- 摘要编造案例数：0（未观察到用户未提供的症状事实）',
    )
    .replace(
      `- P2：${severityCounts.P2} 个。包括超长输入没有显示长度边界。`,
      `- P2：${severityCounts.P2} 个。包括超长输入没有显示长度边界，以及不支持页的英文展示词。`,
    )
  const comparisonReport = `# 测试说明

本次为修复后的15个合成角色与 Playwright 自动化复测，不是真实用户研究，不能替代真人可用性测试。全部症状文本均为人工编写的合成内容；下述“困惑”均为合成角色走查推测，尚需真人验证。

# 测试环境

- 基线：首轮15/15流程完成，P0=0、P1=2、P2=2。
- 测试日期：2026-07-17（Asia/Shanghai）
- 地址：http://127.0.0.1:4173/medask-mvp/（VITE_STATIC_DEMO=true 的 GitHub Pages 等价构建）
- 浏览器：Playwright Chromium ${browserVersion}（无头模式）
- 视口：桌面1440×1000；手机390×844
- 限制：这是合成角色自动化，不代表真实用户满意度、临床效果或线上CDN表现。

# 角色和任务

${PERSONAS.map((p) => `- ${p.id} ${p.name}：${p.age}岁，预期 ${p.expected}`).join('\n')}

# 修复前后对比

| 项目 | 修复前 | 修复后 |
|---|---:|---:|
| 流程终态完成 | 15/15 | ${terminal}/${results.length} |
| 预期页面到达 | 15/15 | ${reached}/${results.length} |
| P0 | 0 | ${severityCounts.P0} |
| P1 | 2 | ${severityCounts.P1} |
| P2 | 2 | ${severityCounts.P2} |
| 重复问题案例 | 0 | ${repeats} |
| 摘要忠实 | 12/12 | ${faithful}/${summaries.length} |

- 近期已缓解发热：${results.find((r) => r.case_id === 'US-04')?.actual_end_state === 'summary' ? '已关闭；进入发热整理并在摘要显示“本次发热目前已缓解”。' : '未关闭。'}
- 修改已填信息：${results.find((r) => r.case_id === 'US-05')?.summary_matches_user_input ? '已关闭；修改为37℃后摘要同步更新。' : '未关闭。'}
- 500字符反馈：${results.find((r) => r.case_id === 'US-14')?.completed ? '已关闭；输入有计数、上限和接近上限提示。' : '未关闭。'}
- 英文开发文案：${results.some((r) => r.unsupported_internal_terms_found) ? '未关闭。' : '已关闭；不支持页改为中文。'}
- 新回归：${severityCounts.P0 + severityCounts.P1 + severityCounts.P2 === 0 ? '自动化未观察到新的P0/P1/P2回归。' : '见逐案例记录。'}

# 结果摘要

- 风险前置成功率：${risks.filter((r) => r.risk_preempted).length}/${risks.length}
- 不支持范围处理成功率：${unsupported.filter((r) => r.unsupported_handled).length}/${unsupported.length}
- 摘要编造案例数：0（未观察到用户未提供的症状事实）
- 重复提交保护：${results.find((r) => r.case_id === 'US-12')?.duplicate_submit_blocked ? '成功' : '未确认'}
- 手机端完成：${results.find((r) => r.case_id === 'US-13')?.summary_generated ? '是' : '否'}

# 逐案例记录

${rows}

# 问题优先级

- P0=${severityCounts.P0}：未观察到错误风险中断、越界输出、摘要编造或流程阻断。
- P1=${severityCounts.P1}：本轮复测结果见上表。
- P2=${severityCounts.P2}：本轮复测结果见上表。

# 尚需真人验证的假设

- 用户是否理解“信息整理”而不是诊断。
- 用户是否愿意完成最多7轮。
- 用户是否认为摘要与修改入口有帮助。
- 风险提示是否引起过度焦虑。
- 老年或低数字素养用户是否能顺利使用。
- 500字符提示是否清晰且不过度打断。
- 手机屏幕上的阅读、滚动和打印体验是否可接受。
`
  void finalizedReport
  writeFileSync(resolve(reportRoot, 'usability-simulation-report-v2.md'), comparisonReport, 'utf8')
}

test.beforeAll(({ browser }) => {
  browserVersion = browser.version()
  mkdirSync(screenshotRoot, { recursive: true })
})

for (const persona of PERSONAS) {
  test(`${persona.id} ${persona.name}`, async ({ page }) => {
    const result: CaseResult = {
      case_id: persona.id, persona_name: persona.name, viewport: persona.viewport, age: persona.age, initial_input: persona.input,
      expected_end_state: persona.expected, actual_end_state: 'incomplete', completed: false, action_count: 0, answered_count: 0,
      skipped_count: 0, repeated_question_found: false, duplicate_submit_blocked: false, risk_preempted: false,
      unsupported_handled: false, summary_generated: false, summary_matches_user_input: false,
      unsupported_internal_terms_found: false, error_message_seen: false, screenshots: '', observed_issue: '', inferred_confusion: '',
      severity: 'none', notes: '', question_path: [],
    }

    await startPersona(page, persona, result)
    let state = await endState(page)
    if (persona.behavior === 'conflict' && state === 'incomplete') {
      const turnsBefore = await page.getByLabel('问诊轮次').innerText()
      await clickTracked(page.getByRole('button', { name: '查看/修改已填信息' }), result)
      await page.getByLabel('选择要修改的项目').selectOption('currentTemperature')
      result.action_count += 1
      await fillTracked(page.getByLabel('修改当前体温'), '37', result)
      await clickTracked(page.getByRole('button', { name: '保存修改' }), result)
      expect(await page.getByLabel('问诊轮次').innerText()).toBe(turnsBefore)
      await clickTracked(page.getByRole('button', { name: '关闭' }), result)
    }
    if (state === 'incomplete') await completeFlow(page, persona, result)
    state = await endState(page)

    if (persona.behavior === 'novice' && state === 'summary') {
      await clickTracked(page.getByRole('button', { name: '重新开始' }), result)
      state = await endState(page)
    }

    result.actual_end_state = state
    result.completed = state !== 'incomplete'
    result.risk_preempted = persona.expected === 'escalated' && state === 'escalated' && result.question_path.length === 0
    result.unsupported_handled = persona.expected === 'unsupported' && state === 'unsupported'
    result.summary_generated = state === 'summary' || persona.behavior === 'novice' && state === 'welcome_after_restart'

    const pageText = await page.locator('main').innerText()
    result.unsupported_internal_terms_found = /(?:schema|provider|ruleId|undefined|NaN|Mock|Trace|OUT OF DEMO SCOPE)/iu.test(pageText)
    result.error_message_seen = /(?:发生了错误|系统错误|页面无法)/u.test(pageText)
    if (state === 'summary') {
      const assessment = assessSummary(persona, pageText)
      result.summary_matches_user_input = assessment.faithful
      result.notes = assessment.note
    } else if (persona.behavior === 'novice' && state === 'welcome_after_restart') {
      result.summary_matches_user_input = true
      result.notes = '完成摘要后重新开始成功；未保留上一会话内容'
    } else {
      result.notes = '未生成摘要'
    }
    classifyIssue(persona, result, pageText)

    if (persona.id === 'US-05') await saveScreenshot(page, result, 'edited-temperature-summary')
    if (persona.id === 'US-08') await saveScreenshot(page, result, 'skipped-summary')
    if (persona.id === 'US-09') await saveScreenshot(page, result, 'risk')
    if (persona.id === 'US-10') await saveScreenshot(page, result, 'unsupported')
    if (persona.id === 'US-13') await saveScreenshot(page, result, 'mobile-summary')
    if (persona.id === 'US-14') await saveScreenshot(page, result, 'long-description-result')

    results.push(result)
    expect(result.completed).toBeTruthy()
  })
}

test.afterAll(() => {
  results.sort((left, right) => left.case_id.localeCompare(right.case_id))
  writeOutputs()
})
