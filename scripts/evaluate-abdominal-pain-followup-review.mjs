import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const INPUT = resolve(ROOT, 'reports', 'abdominal-pain-followup-review.csv')
const OUTPUT = resolve(ROOT, 'reports', 'abdominal-pain-followup-review-gate.md')
const REQUIRED = [
  'human_candidate_current', 'human_candidate_status', 'human_candidate_complaints',
  'human_candidate_intent', 'human_risk_present', 'human_risk_scope', 'human_risk_category',
]
const ABDOMINAL = /腹痛|肚子(?:疼|痛)|胃(?:疼|痛)|小腹(?:疼|痛)|上腹(?:疼|痛)|下腹(?:疼|痛)|腹部[^，。；]{0,5}(?:疼|痛)/u
const NEGATED = /(?:没有|无|否认|不伴|未出现)[^，。；]{0,8}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹部|肚子|胃)[^，。；]{0,6}(?:不疼|不痛)/u
const HISTORICAL = /以前|之前|曾经|去年|小时候|多年前|前段时间|当时|既往/u
const RESOLVED = /缓解|好了|不疼了|不痛了|恢复正常|恢复了|消失/u
const HYPOTHETICAL = /如果|假如|会不会|是什么|有哪些症状|什么原因|为什么会|是否遗传|如何预防/u
const CURRENT = /现在|目前|今天|这两天|这几天|最近|仍然|仍在|一直|又|再次|持续/u
const UNSUPPORTED = /宝宝|婴儿|幼儿|小孩|儿童|男童|女童|孕妇|怀孕|孕周|产后|哺乳期|恶露|(?<!\d)(?:[0-9]|1[0-7])\s*岁/u
const ABDOMINAL_RISK = /(?:突然|剧烈)[^，。；]{0,10}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))[^，。；]{0,10}(?:突然|剧烈)|呕血|黑便|便血|无法排便|不能排便|无法排气|不能排气|晕厥|意识不清|喘不上气|严重呼吸困难/u
const GLOBAL_RISK = /咯血|血尿/u

function parseCsv(text) {
  const records = []; let row = []; let field = ''; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n') { row.push(field.replace(/\r$/u, '')); records.push(row); row = []; field = '' }
    else field += character
  }
  if (field || row.length) { row.push(field.replace(/\r$/u, '')); records.push(row) }
  const headers = records[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/u, '') : value)
  return records.slice(1).filter((values) => values.some(Boolean)).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

const textOf = (row) => `${row.title}。${row.ask}`.replace(/\s+/gu, '')
const ids = (items) => items.length ? items.map((item) => `\`${item.review_id}\``).join('、') : '无'
const pct = (numerator, denominator) => denominator ? `${(numerator / denominator * 100).toFixed(1)}%` : '样本不足'

function occurrence(row) {
  const text = textOf(row)
  if (!ABDOMINAL.test(text)) return 'none'
  const statuses = text.split(/[，。！？；,!?;]|但|然而|不过/u).filter(Boolean).filter((clause) => ABDOMINAL.test(clause)).map((clause) => {
    if (HYPOTHETICAL.test(clause)) return 'hypothetical'
    if (NEGATED.test(clause)) return 'negated'
    if (RESOLVED.test(clause) && !CURRENT.test(clause.replace(/现在(?:已经)?(?:好了|缓解|不疼了|不痛了)/gu, ''))) return 'resolved'
    if (HISTORICAL.test(clause) && !CURRENT.test(clause)) return 'historical'
    return 'current'
  })
  return statuses.at(-1) ?? 'uncertain'
}

async function main() {
  const inputText = await readFile(INPUT, 'utf8')
  const rows = parseCsv(inputText)
  if (rows.length !== 8 || new Set(rows.map((row) => row.review_id)).size !== 8) throw new Error('followup_expected_8_unique')
  if (rows.some((row) => REQUIRED.some((field) => !String(row[field] ?? '').trim()))) throw new Error('followup_labels_incomplete')
  const determinate = rows.filter((row) => ['yes', 'no'].includes(row.human_candidate_current))
  const evaluated = determinate.map((row) => ({ ...row, predicted: occurrence(row) === 'current' ? 'yes' : 'no' }))
  const correct = evaluated.filter((row) => row.predicted === row.human_candidate_current)
  const falsePositive = evaluated.filter((row) => row.predicted === 'yes' && row.human_candidate_current === 'no')
  const falseNegative = evaluated.filter((row) => row.predicted === 'no' && row.human_candidate_current === 'yes')
  const nonCurrentAsCurrent = evaluated.filter((row) => ['resolved', 'historical', 'negated'].includes(row.human_candidate_status) && row.predicted === 'yes')
  const unsupported = rows.filter((row) => row.human_candidate_intent === 'pediatric_or_pregnancy')
  const unsupportedMiss = unsupported.filter((row) => !UNSUPPORTED.test(textOf(row)))
  const abdominalRisk = rows.filter((row) => row.human_risk_present === 'yes' && row.human_risk_scope === 'abdominal_specific')
  const abdominalRiskMiss = abdominalRisk.filter((row) => !ABDOMINAL_RISK.test(textOf(row)))
  const globalRisk = rows.filter((row) => row.human_risk_present === 'yes' && row.human_risk_scope === 'global_other')
  const globalRiskCorrect = globalRisk.filter((row) => GLOBAL_RISK.test(textOf(row)))
  const unresolved = rows.filter((row) => [row.human_candidate_current, row.human_candidate_status, row.human_risk_present, row.human_risk_scope].includes('uncertain'))
  const passed = correct.length / determinate.length >= 0.85 && nonCurrentAsCurrent.length === 0 && unsupportedMiss.length === 0
    && abdominalRiskMiss.length === 0 && globalRiskCorrect.length === globalRisk.length && unresolved.length === 0
  const report = `# 腹痛门禁补充8条评测\n\n> 这是定向患者侧语言标签补充层，不是独立未见集，也不是临床准确率。原20条门禁结果不被覆盖。\n\n| 指标 | 分子/分母或数量 | 结果 | 门槛 |\n|---|---:|---:|---|\n| 标签完成 | 8/8 | 100.0% | 8/8 |\n| 当前性规则准确率 | ${correct.length}/${determinate.length} | ${pct(correct.length, determinate.length)} | ≥85% |\n| 当前性假阳性 | ${falsePositive.length} | ${ids(falsePositive)} | 0为目标 |\n| 当前性假阴性 | ${falseNegative.length} | ${ids(falseNegative)} | 0为目标 |\n| 否定/历史/resolved误写当前 | ${nonCurrentAsCurrent.length} | ${ids(nonCurrentAsCurrent)} | 0 |\n| 不支持人群误路由 | ${unsupportedMiss.length}/${unsupported.length} | ${ids(unsupportedMiss)} | 0 |\n| 腹痛特异风险漏标 | ${abdominalRiskMiss.length}/${abdominalRisk.length} | ${ids(abdominalRiskMiss)} | 0 |\n| 全局其他风险正确路由 | ${globalRiskCorrect.length}/${globalRisk.length} | ${pct(globalRiskCorrect.length, globalRisk.length)} | 全部正确；空集合报样本不足 |\n| 未解决歧义 | ${unresolved.length} | ${ids(unresolved)} | 0 |\n\n## 门禁结论\n\n**${passed ? '补充层通过' : '阻断'}**。${passed ? '但仍需结合原20条失败项决定是否开发。' : '不允许用补充样本稀释原20条失败项；暂不进入生产规则开发。'}\n\n- CSV SHA-256：\`${createHash('sha256').update(inputText).digest('hex')}\`\n- 评测未读取医生answer，未修改生产规则。\n`
  await writeFile(OUTPUT, report, 'utf8')
  console.info(JSON.stringify({ rows: 8, determinate: determinate.length, correct: correct.length, falsePositive: falsePositive.length, falseNegative: falseNegative.length, unsupportedMiss: unsupportedMiss.length, abdominalRiskMiss: abdominalRiskMiss.length, globalRiskCorrect: `${globalRiskCorrect.length}/${globalRisk.length}`, unresolved: unresolved.length, passed }, null, 2))
}

await main()
