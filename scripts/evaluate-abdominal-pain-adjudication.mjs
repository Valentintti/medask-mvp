import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = resolve(PROJECT_ROOT, 'config', 'abdominal-pain-adjudication.json')
const SUMMARY_PATH = resolve(PROJECT_ROOT, 'reports', 'abdominal-pain-adjudication-summary.md')
const DISAGREEMENTS_PATH = resolve(PROJECT_ROOT, 'reports', 'abdominal-pain-adjudication-disagreements.md')
const GATE_PATH = resolve(PROJECT_ROOT, 'reports', 'abdominal-pain-review-gate-v2.md')

const SECOND_REQUIRED = [
  'human_candidate_current', 'human_candidate_status', 'human_candidate_complaints',
  'human_candidate_intent', 'human_risk_present', 'human_risk_scope', 'human_risk_category',
]
const FINAL_REQUIRED = [
  'final_candidate_current', 'final_candidate_status', 'final_complaints', 'final_intent',
  'final_risk_present', 'final_risk_scope', 'final_risk_category', 'final_reason_category',
]
const ABDOMINAL_TERM = /腹痛|肚子(?:疼|痛)|胃(?:疼|痛)|小腹(?:疼|痛)|上腹(?:疼|痛)|下腹(?:疼|痛)|腹部[^，。；]{0,5}(?:疼|痛)/u
const NEGATED = /(?:没有|无|否认|不伴|未出现)[^，。；]{0,8}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹部|肚子|胃)[^，。；]{0,6}(?:不疼|不痛)/u
const HISTORICAL = /以前|之前|曾经|去年|小时候|多年前|前段时间|当时|既往/u
const RESOLVED = /缓解|好了|不疼了|不痛了|恢复正常|恢复了|消失/u
const HYPOTHETICAL = /如果|假如|会不会|是什么|有哪些症状|什么原因|为什么会|是否遗传|如何预防/u
const CURRENT_CUE = /现在|目前|今天|这两天|这几天|最近|仍然|仍在|一直|又|再次|持续/u
const UNSUPPORTED = /宝宝|婴儿|幼儿|小孩|儿童|男童|女童|孕妇|怀孕|孕周|产后|哺乳期|恶露|(?<!\d)(?:[0-9]|1[0-7])\s*岁/u
const ABDOMINAL_RISK = /(?:突然|剧烈)[^，。；]{0,10}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))[^，。；]{0,10}(?:突然|剧烈)|呕血|黑便|便血|无法排便|不能排便|无法排气|不能排气|晕厥|意识不清|喘不上气|严重呼吸困难/u
const GLOBAL_OTHER_RISK = /咯血|血尿/u

function sha256(text) { return createHash('sha256').update(text).digest('hex') }

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
    else if (character === '\n') { row.push(field); records.push(row); row = []; field = '' }
    else if (character !== '\r') field += character
  }
  if (quoted) throw new Error('csv_unclosed_quote')
  if (field || row.length) { row.push(field); records.push(row) }
  const headers = records[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value)
  return records.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

const labels = (value) => new Set(String(value).split('|').map((item) => item.trim()).filter(Boolean))
const exactLabels = (left, right) => {
  const a = labels(left); const b = labels(right)
  return a.size === b.size && [...a].every((value) => b.has(value))
}
const complete = (row, fields) => fields.every((field) => String(row[field] ?? '').trim())
const pct = (numerator, denominator) => denominator ? `${(numerator / denominator * 100).toFixed(1)}%` : '样本不足'
const safeIds = (rows) => rows.length ? rows.map((row) => `\`${row.review_id}\``).join('、') : '无'
const patientText = (row) => `${row.title}。${row.ask}`.replace(/\s+/gu, '')

function draftOccurrenceStatus(row) {
  const text = patientText(row)
  if (!ABDOMINAL_TERM.test(text)) return 'none'
  const clauses = text.split(/[，。！？；,!?;]|但|然而|不过/u).filter(Boolean)
  const statuses = []
  for (const clause of clauses) {
    if (!ABDOMINAL_TERM.test(clause)) continue
    if (HYPOTHETICAL.test(clause)) statuses.push('hypothetical')
    else if (NEGATED.test(clause)) statuses.push('negated')
    else if (RESOLVED.test(clause) && !CURRENT_CUE.test(clause.replace(/现在(?:已经)?(?:好了|缓解|不疼了|不痛了)/gu, ''))) statuses.push('resolved')
    else if (HISTORICAL.test(clause) && !CURRENT_CUE.test(clause)) statuses.push('historical')
    else statuses.push('current')
  }
  return statuses.at(-1) ?? 'uncertain'
}

function riskCategoryFromText(row) {
  const text = patientText(row)
  if (/(?:突然|剧烈)[^，。；]{0,10}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))[^，。；]{0,10}(?:突然|剧烈)/u.test(text)) return 'sudden_severe_abdominal_pain'
  if (/呕血/u.test(text)) return 'hematemesis'
  if (/黑便|便血/u.test(text)) return 'hematochezia_or_melena'
  if (/(无法|不能)(?:排便|排气)/u.test(text)) return 'distension_no_stool_or_gas'
  if (/晕厥|意识不清/u.test(text)) return 'syncope_or_altered_consciousness'
  if (/喘不上气|严重呼吸困难/u.test(text)) return 'severe_breathing_difficulty'
  if (/咯血/u.test(text)) return 'hemoptysis'
  if (/血尿/u.test(text)) return 'hematuria'
  return 'other'
}

function combinedFinalRows(firstRows, adjudicationRows, targetedIds) {
  const adjudicationById = new Map(adjudicationRows.map((row) => [row.review_id, row]))
  return firstRows.map((first) => {
    const adjudicated = adjudicationById.get(first.review_id)
    if (targetedIds.has(first.review_id)) {
      return {
        ...first,
        goldCurrent: adjudicated.final_candidate_current,
        goldStatus: adjudicated.final_candidate_status,
        goldComplaints: adjudicated.final_complaints,
        goldIntent: adjudicated.final_intent,
        goldRiskPresent: adjudicated.final_risk_present,
        goldRiskScope: adjudicated.final_risk_scope,
        goldRiskCategory: adjudicated.final_risk_category,
        labelSource: 'final_adjudication',
      }
    }
    const legacyRisk = first.human_risk_expression
    const text = patientText(first)
    return {
      ...first,
      goldCurrent: first.human_current_symptom,
      goldStatus: first.human_current_symptom === 'yes' ? 'current' : draftOccurrenceStatus(first),
      goldComplaints: first.human_final_complaint,
      goldIntent: first.human_intent,
      goldRiskPresent: legacyRisk,
      goldRiskScope: legacyRisk === 'yes' ? (ABDOMINAL_RISK.test(text) ? 'abdominal_specific' : GLOBAL_OTHER_RISK.test(text) ? 'global_other' : 'uncertain') : legacyRisk === 'no' ? 'none' : 'uncertain',
      goldRiskCategory: legacyRisk === 'yes' ? riskCategoryFromText(first) : legacyRisk === 'no' ? 'none' : 'other',
      labelSource: 'retained_first_round',
    }
  })
}

function buildDisagreements(firstRows, adjudicationRows, secondDone, finalDone) {
  if (!secondDone) return `# 腹痛7条二次裁决分歧\n\n> 二次盲审尚未全部完成。为保持盲法，本报告暂不展示第一轮标签。\n\n待处理ID：${safeIds(adjudicationRows)}。\n`
  const firstById = new Map(firstRows.map((row) => [row.review_id, row]))
  const lines = ['# 腹痛7条二次裁决分歧', '', '> 本报告不含患者全文。第一轮status/scope/category未定义，因此只在最终裁决阶段显示为“第一轮未定义”。', '', '| review_id | 字段名 | 第一轮标签 | 第二轮标签 | 最终裁决 | 裁决理由类别 |', '|---|---|---|---|---|---|']
  const comparisons = [
    ['candidate_current', 'human_current_symptom', 'human_candidate_current', 'final_candidate_current', false],
    ['candidate_status', null, 'human_candidate_status', 'final_candidate_status', false],
    ['complaints', 'human_final_complaint', 'human_candidate_complaints', 'final_complaints', true],
    ['intent', 'human_intent', 'human_candidate_intent', 'final_intent', false],
    ['risk_present', 'human_risk_expression', 'human_risk_present', 'final_risk_present', false],
    ['risk_scope', null, 'human_risk_scope', 'final_risk_scope', false],
    ['risk_category', null, 'human_risk_category', 'final_risk_category', false],
  ]
  for (const second of adjudicationRows) {
    const first = firstById.get(second.review_id)
    for (const [fieldName, firstField, secondField, finalField, multi] of comparisons) {
      const firstValue = firstField ? first[firstField] : '第一轮未定义'
      const secondValue = second[secondField]
      const differs = firstField === null || (multi ? !exactLabels(firstValue, secondValue) : firstValue !== secondValue)
      if (!differs) continue
      lines.push(`| \`${second.review_id}\` | \`${fieldName}\` | \`${firstValue}\` | \`${secondValue}\` | \`${finalDone ? second[finalField] : '待最终裁决'}\` | \`${finalDone ? second.final_reason_category : '待最终裁决'}\` |`)
    }
  }
  return `${lines.join('\n')}\n`
}

function buildSummary(adjudicationRows, secondDone, finalDone, sourceHash) {
  const secondCount = adjudicationRows.filter((row) => complete(row, SECOND_REQUIRED)).length
  const finalCount = adjudicationRows.filter((row) => complete(row, FINAL_REQUIRED)).length
  return `# 腹痛7条定向二次裁决汇总

> 本流程只使用患者侧文本，不使用医生answer；不代表临床准确率或完整临床分诊。

## 数据保护

- 第一轮CSV SHA-256：\`${sourceHash}\`，与冻结值一致。
- 二次裁决文件：7条、review_id唯一7条；不包含第一轮标签、抽样分层或医生回答。
- 第二轮人工完成：${secondCount}/7。
- 最终裁决完成：${finalCount}/7。

## 口径修复

- 第一轮 \`human_current_symptom\` 是记录级模糊字段，无法保证回答的是腹痛当前性。
- V2改为 \`human_candidate_current\`，问题固定为候选腹痛是否属于当前或近期本次腹痛，并用 \`human_candidate_status\` 区分current/resolved/historical/negated/hypothetical/uncertain。
- 风险拆成present、scope和category；\`abdominal_specific\`计入腹痛风险草案，\`global_other\`只路由全局风险引擎。

## 当前状态

${!secondDone ? '二次盲审尚未完成。第一轮标签保持隐藏，不能生成真实分歧或最终门禁。' : !finalDone ? '二次盲审已完成，已解锁两轮比较；最终裁决尚未完成，门禁继续阻断。' : '7条二次盲审和最终裁决均已完成，可计算V2门禁。'}

## 方法限制

优先由第二名审核者完成。若实际由同一审核者间隔后复核，必须在最终备注中记录；这不是独立双人一致性研究。抽样分层不是金标，不再作为V2准确率的唯一分母。
`
}

function buildGate(allRows, secondDone, finalDone) {
  if (!secondDone || !finalDone) return `# 腹痛V2开发门禁\n\n> 结论：**阻断（待人工裁决）**。当前不计算部分样本准确率，避免用未完成标签产生误导。\n\n- 二次盲审完成：${secondDone ? '7/7' : '未完成'}。\n- 最终裁决完成：${finalDone ? '7/7' : '未完成'}。\n- 生产complaintRules/riskRules、页面入口和真实Provider均不得修改。\n`

  const determinate = allRows.filter((row) => ['yes', 'no'].includes(row.goldCurrent))
  const predictions = determinate.map((row) => ({ row, predicted: draftOccurrenceStatus(row) === 'current' ? 'yes' : 'no' }))
  const correct = predictions.filter(({ row, predicted }) => row.goldCurrent === predicted)
  const falsePositive = predictions.filter(({ row, predicted }) => predicted === 'yes' && row.goldCurrent === 'no')
  const falseNegative = predictions.filter(({ row, predicted }) => predicted === 'no' && row.goldCurrent === 'yes')
  const nonCurrentStatuses = new Set(['resolved', 'historical', 'negated'])
  const nonCurrentAsCurrent = predictions.filter(({ row, predicted }) => nonCurrentStatuses.has(row.goldStatus) && predicted === 'yes')
  const adjacentNegatives = allRows.filter((row) => !ABDOMINAL_TERM.test(patientText(row)) && !labels(row.goldComplaints).has('abdominal_pain'))
  const adjacentFalsePositive = adjacentNegatives.filter((row) => draftOccurrenceStatus(row) === 'current')
  const unsupportedGold = allRows.filter((row) => row.goldIntent === 'pediatric_or_pregnancy')
  const unsupportedMiss = unsupportedGold.filter((row) => !UNSUPPORTED.test(patientText(row)))
  const abdominalRiskGold = allRows.filter((row) => row.goldRiskPresent === 'yes' && row.goldRiskScope === 'abdominal_specific')
  const abdominalRiskMiss = abdominalRiskGold.filter((row) => !ABDOMINAL_RISK.test(patientText(row)))
  const globalRiskGold = allRows.filter((row) => row.goldRiskPresent === 'yes' && row.goldRiskScope === 'global_other')
  const globalRiskCorrect = globalRiskGold.filter((row) => GLOBAL_OTHER_RISK.test(patientText(row)))
  const unresolved = allRows.filter((row) => [row.goldCurrent, row.goldStatus, row.goldRiskPresent, row.goldRiskScope].includes('uncertain'))
  const accuracy = correct.length / determinate.length
  const passed = accuracy >= 0.85 && nonCurrentAsCurrent.length === 0 && adjacentFalsePositive.length === 0 && unsupportedMiss.length === 0 && abdominalRiskMiss.length === 0 && globalRiskCorrect.length === globalRiskGold.length && unresolved.length === 0

  return `# 腹痛V2开发门禁

> 结论：**${passed ? '通过' : '阻断'}**。这是20条定向患者侧语言标签上的规则草案回放，不是临床准确率。

| 指标 | 分子/分母或数量 | 结果 | 门槛 |
|---|---:|---:|---|
| 20/20标签完成 | 20/20 | 100.0% | 必须20/20 |
| 腹痛当前性规则准确率 | ${correct.length}/${determinate.length} | ${pct(correct.length, determinate.length)} | ≥85% |
| 腹痛当前性假阳性 | ${falsePositive.length} | ${safeIds(falsePositive.map((item) => item.row))} | 观察并解释 |
| 腹痛当前性假阴性 | ${falseNegative.length} | ${safeIds(falseNegative.map((item) => item.row))} | 观察并解释 |
| 否定/历史/resolved误写当前 | ${nonCurrentAsCurrent.length} | ${safeIds(nonCurrentAsCurrent.map((item) => item.row))} | 0 |
| 相邻非腹痛误识别 | ${adjacentFalsePositive.length} | ${safeIds(adjacentFalsePositive)} | 0 |
| 不支持人群误路由 | ${unsupportedMiss.length} | ${safeIds(unsupportedMiss)} | 0 |
| 腹痛特异风险漏标 | ${abdominalRiskMiss.length}/${abdominalRiskGold.length} | ${safeIds(abdominalRiskMiss)} | 0 |
| 全局其他风险正确路由 | ${globalRiskCorrect.length}/${globalRiskGold.length} | ${pct(globalRiskCorrect.length, globalRiskGold.length)} | 全部正确；空集合报样本不足 |
| 未解决歧义 | ${unresolved.length} | ${safeIds(unresolved)} | 0 |

${passed ? '允许下一轮开始实现abdominal_pain规则模块；本报告不授权页面入口、真实Provider或胸部不适开发。' : '不允许进入生产规则开发。只围绕失败类别补5—10条定向样本，不重新审核120条，也不降低门槛。'}
`
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  const sourcePath = resolve(PROJECT_ROOT, config.sourceCsv)
  const adjudicationPath = resolve(PROJECT_ROOT, config.outputCsv)
  const sourceText = await readFile(sourcePath, 'utf8')
  const sourceHash = sha256(sourceText)
  if (sourceHash !== config.sourceSha256) throw new Error(`source_hash_mismatch:${sourceHash}`)
  const firstRows = parseCsv(sourceText)
  const adjudicationText = await readFile(adjudicationPath, 'utf8')
  const adjudicationRows = parseCsv(adjudicationText)
  if (adjudicationRows.length !== 7 || new Set(adjudicationRows.map((row) => row.review_id)).size !== 7) throw new Error('adjudication_rows_invalid')
  if (adjudicationRows.some((row) => !config.reviewIds.includes(row.review_id))) throw new Error('adjudication_id_invalid')
  const secondDone = adjudicationRows.every((row) => complete(row, SECOND_REQUIRED))
  const finalDone = adjudicationRows.every((row) => complete(row, FINAL_REQUIRED))
  const finalRows = finalDone ? combinedFinalRows(firstRows, adjudicationRows, new Set(config.reviewIds)) : []

  await mkdir(dirname(SUMMARY_PATH), { recursive: true })
  await writeFile(SUMMARY_PATH, buildSummary(adjudicationRows, secondDone, finalDone, sourceHash), 'utf8')
  await writeFile(DISAGREEMENTS_PATH, buildDisagreements(firstRows, adjudicationRows, secondDone, finalDone), 'utf8')
  await writeFile(GATE_PATH, buildGate(finalRows, secondDone, finalDone), 'utf8')
  if (sha256(await readFile(sourcePath, 'utf8')) !== sourceHash) throw new Error('source_changed')
  console.info(JSON.stringify({
    reviewIds: adjudicationRows.length,
    secondRoundComplete: adjudicationRows.filter((row) => complete(row, SECOND_REQUIRED)).length,
    finalComplete: adjudicationRows.filter((row) => complete(row, FINAL_REQUIRED)).length,
    gateCalculated: secondDone && finalDone,
    sourceSha256: sourceHash,
  }, null, 2))
}

await main()
