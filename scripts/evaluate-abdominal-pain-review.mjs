import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INPUT_CSV = resolve(PROJECT_ROOT, 'reports', 'abdominal-pain-targeted-review.csv')
const OUTPUT_REPORT = resolve(PROJECT_ROOT, 'reports', 'abdominal-pain-review-gate.md')

const REQUIRED_HUMAN_FIELDS = [
  'human_is_valid',
  'human_current_symptom',
  'human_final_complaint',
  'human_intent',
  'human_risk_expression',
]
const VALIDITY = new Set(['yes', 'no', 'uncertain'])
const INTENTS = new Set([
  'symptom_intake', 'diagnosed_followup', 'medication_query', 'report_interpretation',
  'hospital_or_cost', 'disease_knowledge', 'pediatric_or_pregnancy',
  'invalid_or_template', 'uncertain',
])
const COMPLAINTS = new Set([
  'fever', 'cough', 'headache', 'dizziness', 'abdominal_pain',
  'chest_discomfort', 'other', 'uncertain',
])
const STRATA = {
  current_affirmed: 4,
  negated_historical_resolved: 4,
  adjacent_expression_without_pain: 4,
  mismatch_template_invalid: 3,
  unsupported_population: 2,
  possible_risk_expression: 3,
}

// 该表达式只实现已冻结的腹痛风险草案词面范围，不声称是完整临床分诊规则。
const FROZEN_RISK_DRAFT = /(?:突然|剧烈)[^，。；]{0,10}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))[^，。；]{0,10}(?:突然|剧烈)|呕血|黑便|便血|无法排便|不能排便|无法排气|不能排气|晕厥|意识不清|喘不上气|严重呼吸困难/u

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function parseCsv(text) {
  const records = []
  let row = []; let field = ''; let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1 }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n') { row.push(field); records.push(row); row = []; field = '' }
    else if (character !== '\r') field += character
  }
  if (quoted) throw new Error('csv_unclosed_quote')
  if (field || row.length) { row.push(field); records.push(row) }
  if (!records.length) throw new Error('csv_empty')
  const headers = records[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value)
  return {
    headers,
    rows: records.slice(1).filter((values) => values.some((value) => value !== '')).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))),
  }
}

function countBy(rows, field) {
  const counts = new Map()
  for (const row of rows) counts.set(row[field] || '(blank)', (counts.get(row[field] || '(blank)') ?? 0) + 1)
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right))
}

function labels(value) {
  return new Set(String(value).split('|').map((item) => item.trim()).filter(Boolean))
}

function percent(numerator, denominator) {
  return denominator ? `${(numerator / denominator * 100).toFixed(1)}%` : '样本不足'
}

function ids(rows) {
  return rows.length ? rows.map((row) => `\`${row.review_id}\``).join('、') : '无'
}

function validate(headers, rows) {
  const required = new Set([
    'review_id', 'source_row_id', 'title', 'ask', 'candidate_complaint', 'sampling_reason',
    ...REQUIRED_HUMAN_FIELDS, 'human_notes',
  ])
  const missing = [...required].filter((field) => !headers.includes(field))
  if (missing.length) throw new Error(`missing_fields:${missing.join(',')}`)
  if (headers.some((field) => ['answer', 'original_answer', 'doctor_answer'].includes(field))) throw new Error('doctor_answer_field_forbidden')
  if (rows.length !== 20) throw new Error(`expected_20_rows:${rows.length}`)
  if (new Set(rows.map((row) => row.review_id)).size !== 20) throw new Error('duplicate_review_id')
  for (const [stratum, expected] of Object.entries(STRATA)) {
    const actual = rows.filter((row) => row.sampling_reason === stratum).length
    if (actual !== expected) throw new Error(`stratum_mismatch:${stratum}:${actual}/${expected}`)
  }
  for (const row of rows) {
    if (row.candidate_complaint !== 'abdominal_pain') throw new Error(`unexpected_candidate:${row.review_id}`)
    if (REQUIRED_HUMAN_FIELDS.some((field) => !row[field].trim())) throw new Error(`incomplete_review:${row.review_id}`)
    if (!VALIDITY.has(row.human_is_valid) || !VALIDITY.has(row.human_current_symptom) || !VALIDITY.has(row.human_risk_expression)) throw new Error(`invalid_tri_state:${row.review_id}`)
    if (!INTENTS.has(row.human_intent)) throw new Error(`invalid_intent:${row.review_id}`)
    const invalidComplaints = [...labels(row.human_final_complaint)].filter((value) => !COMPLAINTS.has(value))
    if (invalidComplaints.length) throw new Error(`invalid_complaint:${row.review_id}`)
  }
}

function buildReport(rows, inputHash) {
  const complete = rows.filter((row) => REQUIRED_HUMAN_FIELDS.every((field) => row[field].trim())).length
  const currentPositive = rows.filter((row) => row.human_is_valid === 'yes' && row.human_current_symptom === 'yes' && labels(row.human_final_complaint).has('abdominal_pain'))
  const finalIncludesCandidate = rows.filter((row) => labels(row.human_final_complaint).has('abdominal_pain'))

  const positiveRows = rows.filter((row) => row.sampling_reason === 'current_affirmed')
  const positiveAgreement = positiveRows.filter((row) => row.human_current_symptom === 'yes' && labels(row.human_final_complaint).has('abdominal_pain'))
  const nonCurrentRows = rows.filter((row) => row.sampling_reason === 'negated_historical_resolved')
  const nonCurrentAgreement = nonCurrentRows.filter((row) => row.human_current_symptom === 'no')
  const adjacentRows = rows.filter((row) => row.sampling_reason === 'adjacent_expression_without_pain')
  const adjacentAgreement = adjacentRows.filter((row) => !labels(row.human_final_complaint).has('abdominal_pain'))
  const boundaryNumerator = positiveAgreement.length + nonCurrentAgreement.length + adjacentAgreement.length
  const boundaryDenominator = positiveRows.length + nonCurrentRows.length + adjacentRows.length
  const boundaryDisagreements = [
    ...positiveRows.filter((row) => !positiveAgreement.includes(row)),
    ...nonCurrentRows.filter((row) => !nonCurrentAgreement.includes(row)),
    ...adjacentRows.filter((row) => !adjacentAgreement.includes(row)),
  ]

  const unsupportedRows = rows.filter((row) => row.sampling_reason === 'unsupported_population')
  const unsupportedCorrect = unsupportedRows.filter((row) => row.human_intent === 'pediatric_or_pregnancy')
  const unsupportedMisrouted = unsupportedRows.filter((row) => row.human_intent !== 'pediatric_or_pregnancy')

  const targetedRiskRows = rows.filter((row) => row.sampling_reason === 'possible_risk_expression')
  const targetedRiskMarked = targetedRiskRows.filter((row) => row.human_risk_expression === 'yes')
  const humanRiskYes = rows.filter((row) => row.human_risk_expression === 'yes')
  const frozenRiskCovered = humanRiskYes.filter((row) => FROZEN_RISK_DRAFT.test(`${row.title}。${row.ask}`))
  const frozenRiskGaps = humanRiskYes.filter((row) => !FROZEN_RISK_DRAFT.test(`${row.title}。${row.ask}`))
  const riskUncertain = rows.filter((row) => row.human_risk_expression === 'uncertain')
  const unresolvedIds = new Set([...boundaryDisagreements, ...frozenRiskGaps, ...riskUncertain].map((row) => row.review_id))

  const noMajorAmbiguity = boundaryDisagreements.length === 0 && frozenRiskGaps.length === 0 && riskUncertain.length === 0
  const gates = [
    complete === 20,
    boundaryNumerator / boundaryDenominator >= 0.85,
    nonCurrentRows.length === nonCurrentAgreement.length,
    unsupportedMisrouted.length === 0,
    frozenRiskGaps.length === 0 && targetedRiskMarked.length === targetedRiskRows.length,
    noMajorAmbiguity,
  ]
  const decision = gates.every(Boolean) ? '通过' : '阻断'

  const distributionTable = (field) => countBy(rows, field).map(([value, count]) => `| \`${value}\` | ${count} |`).join('\n')
  return `# 腹痛20条定向人工复核开发门禁

> 结论：**${decision}**。本报告只评估患者侧语言标签和规则设计边界，不代表临床准确率、诊断能力或医疗安全性。未读取医生 \`answer\`，未修改人工标签。

## 输入与完整性

- 输入：\`reports/abdominal-pain-targeted-review.csv\`
- SHA-256：\`${inputHash}\`
- 记录数：${rows.length}；唯一 review_id：${new Set(rows.map((row) => row.review_id)).size}。
- 五个必填人工字段完整：${complete}/20。
- 医生回答字段：0。
- 严格当前腹痛：${currentPositive.length}/20。分子为 \`valid=yes\`、\`current=yes\` 且最终标签包含 \`abdominal_pain\`。
- 最终标签包含腹痛：${finalIncludesCandidate.length}/20；该数字不等于当前腹痛，因为近期已缓解/历史记录也可能保留事件主诉。

## 人工标签分布

### 当前性

| 标签 | 数量 |
|---|---:|
${distributionTable('human_current_symptom')}

### 咨询意图

| 标签 | 数量 |
|---|---:|
${distributionTable('human_intent')}

### 风险表达

| 标签 | 数量 |
|---|---:|
${distributionTable('human_risk_expression')}

## 门禁结果

| 门槛 | 分子/分母 | 结果 | 判定 |
|---|---:|---:|---|
| 20条全部人工完成 | ${complete}/20 | ${percent(complete, 20)} | ${complete === 20 ? '通过' : '阻断'} |
| 当前腹痛与非腹痛严格分层一致率 | ${boundaryNumerator}/${boundaryDenominator} | ${percent(boundaryNumerator, boundaryDenominator)} | ${boundaryNumerator / boundaryDenominator >= 0.85 ? '通过' : '阻断'} |
| 否定/历史/已缓解未标成当前 | ${nonCurrentAgreement.length}/${nonCurrentRows.length} | ${percent(nonCurrentAgreement.length, nonCurrentRows.length)} | ${nonCurrentRows.length === nonCurrentAgreement.length ? '通过' : '需裁决'} |
| 不支持人群正确分流 | ${unsupportedCorrect.length}/${unsupportedRows.length} | ${percent(unsupportedCorrect.length, unsupportedRows.length)} | ${unsupportedMisrouted.length === 0 ? '通过' : '阻断'} |
| 定向风险样本被人工标记 | ${targetedRiskMarked.length}/${targetedRiskRows.length} | ${percent(targetedRiskMarked.length, targetedRiskRows.length)} | ${targetedRiskMarked.length === targetedRiskRows.length ? '通过' : '阻断'} |
| 冻结风险草案词面覆盖人工yes | ${frozenRiskCovered.length}/${humanRiskYes.length} | ${percent(frozenRiskCovered.length, humanRiskYes.length)} | ${frozenRiskGaps.length === 0 ? '通过' : '阻断'} |
| 无未解决重大歧义 | 0/${unresolvedIds.size}个唯一ID | — | ${noMajorAmbiguity ? '通过' : '阻断'} |

### 分层明细

- 当前明确腹痛：${positiveAgreement.length}/${positiveRows.length} 与冻结边界一致。
- 否定/历史/已缓解：${nonCurrentAgreement.length}/${nonCurrentRows.length} 标为非当前；其余需判断是否存在转折复发或人工字段主体理解差异。
- 相邻表达未明确疼痛：${adjacentAgreement.length}/${adjacentRows.length} 未加入腹痛；其余需二次裁决是否存在词典未覆盖的真实疼痛表达。
- mismatch/template抽样中，人工标记有效 ${rows.filter((row) => row.sampling_reason === 'mismatch_template_invalid' && row.human_is_valid === 'yes').length}/3，说明抽样规则在该层存在假阳性，不应直接作为无效规则上线依据。

## 需要定向二次裁决的ID

- 边界分层与人工标签不一致：${ids(boundaryDisagreements)}。
- 人工风险为yes但冻结风险草案未覆盖：${ids(frozenRiskGaps)}。
- 人工风险为uncertain：${ids(riskUncertain)}。
- 不支持人群误入成人意图：${ids(unsupportedMisrouted)}。

以上只列稳定ID，不包含患者原文。分层差异不自动判定为人工错误：可能是抽样规则误分、转折复发、同义表达缺口或人工对 \`human_current_symptom\` 主体理解不同。

## 放行结论与停止条件

当前结论为 **${decision}**。${decision === '通过' ? '可以进入腹痛规则实现，但仍不得将结果描述为临床验证。' : '暂不修改生产 complaintRules/riskRules，也不增加页面入口。只对上述ID进行第二人裁决或补充字段定义；不重新随机审核120条。'}

本轮观察到的核心缺口是：记录级 \`human_current_symptom\` 容易与候选主诉级当前性混淆，以及人工风险标签可能采用了比冻结草案更宽的定义。解决这两个口径问题后再重算同一门禁，不得降低阈值换取放行。
`
}

async function main() {
  const beforeText = await readFile(INPUT_CSV, 'utf8')
  const beforeHash = sha256(beforeText)
  const { headers, rows } = parseCsv(beforeText)
  validate(headers, rows)
  const report = buildReport(rows, beforeHash)
  await mkdir(dirname(OUTPUT_REPORT), { recursive: true })
  await writeFile(OUTPUT_REPORT, report, 'utf8')
  const afterHash = sha256(await readFile(INPUT_CSV, 'utf8'))
  if (afterHash !== beforeHash) throw new Error('input_csv_changed')
  console.info(JSON.stringify({
    reviewed: rows.length,
    complete: rows.filter((row) => REQUIRED_HUMAN_FIELDS.every((field) => row[field].trim())).length,
    inputSha256: beforeHash,
    report: OUTPUT_REPORT,
  }, null, 2))
}

await main()
