import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = resolve(PROJECT_ROOT, 'config', 'abdominal-pain-review.json')
const OUTPUT_FIELDS = [
  'review_id', 'source_row_id', 'title', 'ask', 'candidate_complaint', 'sampling_reason',
  'human_is_valid', 'human_current_symptom', 'human_final_complaint', 'human_intent',
  'human_risk_expression', 'human_notes',
]
const HUMAN_FIELDS = OUTPUT_FIELDS.slice(6)

const ABDOMINAL_PAIN = /腹痛|肚子(?:疼|痛)|胃(?:疼|痛)|小腹(?:疼|痛)|上腹(?:疼|痛)|下腹(?:疼|痛)|腹部[^，。；]{0,5}(?:疼|痛)/u
const ADJACENT_EXPRESSION = /腹胀|胀气|恶心|反酸|烧心|胃不舒服|胃部不适|胃口差|食欲(?:差|下降|不振)/u
const NON_TARGET_PAIN = /腰痛|腰疼|胸痛|胸口疼|经期不适|月经不适|痛经/u
const NEGATED_PAIN = /(?:没有|无|否认|不伴|未出现)[^，。；]{0,8}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹部|肚子|胃)[^，。；]{0,6}(?:不疼|不痛)/u
const HISTORICAL_PAIN = /(?:以前|之前|曾经|去年|小时候|多年前|前段时间)[^。；]{0,18}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))/u
const RESOLVED_PAIN = /(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))[^。；]{0,18}(?:已经|已|现在)?(?:缓解|好了|不疼了|不痛了|恢复正常)|(?:已经|已)(?:缓解|好了|不疼|不痛)[^。；]{0,12}(?:腹痛|肚子|胃)/u
const HYPOTHETICAL_OR_KNOWLEDGE = /如果|假如|会不会|是什么|有哪些症状|什么原因|为什么会|是否遗传|如何预防/u
const UNSUPPORTED_KEYWORDS = /宝宝|婴儿|幼儿|小孩|儿童|男童|女童|孕妇|怀孕|孕周|产后|哺乳期|恶露/u
const UNDER_18 = /(?<!\d)(?:[0-9]|1[0-7])\s*岁|(?:一|二|三|四|五|六|七|八|九|十|十一|十二|十三|十四|十五|十六|十七)岁/u
const INVALID_ASK = /^\s*(?:无|没有|不知道|问题描述[:：]?)?\s*$|患者性别.*患者年龄.*问题描述|<[^>]+>/u
const RISK_EXPRESSION = /(?:突然|剧烈)[^，。；]{0,10}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))[^，。；]{0,10}(?:突然|剧烈)|呕血|黑便|便血|无法排便|不能排便|无法排气|不能排气|晕厥|意识不清|喘不上气|严重呼吸困难/u

function parseArgs(argv) {
  const result = { check: false, dataRoot: '', outputDir: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--check') result.check = true
    else if (value === '--data-root') result.dataRoot = argv[++index] ?? ''
    else if (value === '--output-dir') result.outputDir = argv[++index] ?? ''
    else throw new Error(`unknown_argument:${value}`)
  }
  return result
}

function parseCsv(text) {
  const input = text.replace(/^\uFEFF/u, '')
  const matrix = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1 }
      else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') { row.push(field); field = '' }
    else if (character === '\n') { row.push(field.replace(/\r$/u, '')); matrix.push(row); row = []; field = '' }
    else field += character
  }
  if (quoted) throw new Error('csv_unclosed_quote')
  if (field || row.length) { row.push(field.replace(/\r$/u, '')); matrix.push(row) }
  if (matrix.length === 0) throw new Error('csv_empty')
  const headers = matrix[0]
  if (headers.length !== new Set(headers).size) throw new Error('csv_duplicate_header')
  return matrix.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  )
}

function encodeCsv(rows) {
  const escape = (value) => {
    const text = String(value ?? '')
    return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return `\uFEFF${[OUTPUT_FIELDS, ...rows.map((row) => OUTPUT_FIELDS.map((field) => row[field] ?? ''))]
    .map((values) => values.map(escape).join(','))
    .join('\r\n')}\r\n`
}

const normalizedText = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').replace(/[，。！？；：,.!?;:'"“”‘’（）()【】\[\]]/gu, '')
const rowText = (row) => `${row.original_title ?? ''} ${row.original_ask ?? ''}`.trim()
const patientText = (row) => String(row.patient_text || row.original_ask || row.original_title || '').trim()
const sha256Text = (text) => createHash('sha256').update(text).digest('hex')
const fingerprint = (row) => sha256Text(`${normalizedText(row.original_title)}|${normalizedText(row.original_ask)}`)
const splitLabels = (value) => new Set(String(value ?? '').split('|').map((item) => item.trim()).filter(Boolean))

function normalizeGold(row, version) {
  const prefix = version === 'gold_v2' ? 'validation_' : ''
  return {
    ...row, goldVersion: version,
    humanIsValid: row[`${prefix}human_is_valid`] ?? '',
    humanCurrentSymptom: row[`${prefix}human_current_symptom`] ?? '',
    humanFinalComplaint: row[`${prefix}human_final_complaint`] ?? '',
    humanIntent: row[`${prefix}human_intent`] ?? '',
    humanNotes: row[`${prefix}human_notes`] ?? '',
  }
}

const hasUnsupportedPopulation = (row) => UNSUPPORTED_KEYWORDS.test(rowText(row)) || UNDER_18.test(rowText(row))
const hasInvalidOrMismatch = (row) => String(row.title_ask_mismatch).toLowerCase() === 'true'
  || INVALID_ASK.test(String(row.original_ask ?? '')) || String(row.preliminary_intent) === 'invalid_or_template'
const hasNonCurrentContext = (row) => String(row.negation_detected).toLowerCase() === 'true'
  || String(row.historical_context_detected).toLowerCase() === 'true'
  || NEGATED_PAIN.test(rowText(row)) || HISTORICAL_PAIN.test(rowText(row)) || RESOLVED_PAIN.test(rowText(row))
const hasCurrentRisk = (row) => RISK_EXPRESSION.test(rowText(row)) && !hasNonCurrentContext(row)

function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function seedFor(seed, label) {
  return createHash('sha256').update(`${seed}:${label}`).digest().readUInt32LE(0)
}

function deterministicSample(pool, count, seed, label, usedIds, usedFingerprints) {
  const eligible = pool.filter((row) => !usedIds.has(row.review_id) && !usedFingerprints.has(fingerprint(row)))
    .sort((left, right) => String(left.review_id).localeCompare(String(right.review_id), 'en'))
  const random = createRandom(seedFor(seed, label))
  for (let index = eligible.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[eligible[index], eligible[swap]] = [eligible[swap], eligible[index]]
  }
  if (eligible.length < count) throw new Error(`insufficient_stratum:${label}:${eligible.length}/${count}`)
  const selected = eligible.slice(0, count)
  selected.forEach((row) => { usedIds.add(row.review_id); usedFingerprints.add(fingerprint(row)) })
  return selected
}

function countBy(rows, getter) {
  const counts = new Map()
  for (const row of rows) {
    const key = getter(row) || '(blank)'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right, 'en')))
}

const markdownTable = (record) => Object.entries(record).map(([key, count]) => `| \`${key}\` | ${count} |`).join('\n')

function createAuditReport({ files, goldRows, untouchedAbdominal, broaderAdjacent, broaderUnsupported, selections, seed, hashes }) {
  const strictCurrent = goldRows.filter((row) => row.humanIsValid === 'yes' && row.humanCurrentSymptom === 'yes'
    && splitLabels(row.humanFinalComplaint).has('abdominal_pain')).length
  const boundary = {
    negated: goldRows.filter((row) => NEGATED_PAIN.test(rowText(row)) || String(row.negation_detected).toLowerCase() === 'true').length,
    historical: goldRows.filter((row) => HISTORICAL_PAIN.test(rowText(row)) || String(row.historical_context_detected).toLowerCase() === 'true').length,
    resolved: goldRows.filter((row) => RESOLVED_PAIN.test(rowText(row))).length,
    hypothetical: goldRows.filter((row) => row.humanIntent === 'disease_knowledge' || HYPOTHETICAL_OR_KNOWLEDGE.test(rowText(row))).length,
    invalid: goldRows.filter(hasInvalidOrMismatch).length,
    unsupported: goldRows.filter((row) => row.humanIntent === 'pediatric_or_pregnancy' || hasUnsupportedPopulation(row)).length,
    adjacent: goldRows.filter((row) => ADJACENT_EXPRESSION.test(rowText(row))).length,
    nonTarget: goldRows.filter((row) => NON_TARGET_PAIN.test(rowText(row))).length,
  }
  return `# 腹痛患者侧边界审计

> 本报告只分析患者侧 \`title/ask/patient_text\` 与既有人工标签，不读取或使用医生 \`answer\`。统计用于语言标签与产品规则设计，不代表临床准确率、诊断能力或医疗安全性。

## 数据范围与完整性

- gold_v1 腹痛：${goldRows.filter((row) => row.goldVersion === 'gold_v1').length} 条。
- gold_v2 腹痛：${goldRows.filter((row) => row.goldVersion === 'gold_v2').length} 条。
- 合并人工标签：${goldRows.length} 条，review_id 唯一 ${new Set(goldRows.map((row) => row.review_id)).size} 条。
- 严格当前腹痛：${strictCurrent}/${goldRows.length}。定义为 \`is_valid=yes\`、\`current_symptom=yes\` 且最终多标签包含 \`abdominal_pain\`。
- 非空人工备注：${goldRows.filter((row) => row.humanNotes.trim()).length}/${goldRows.length}；只用于聚合审计，不引用备注原文。
- 排除所有 gold 的 review_id、source_row 和规范化 title+ask 后，剩余腹痛字面候选 ${untouchedAbdominal.length} 条。
- 所有源文件均未读取医生 \`answer\` 字段。

| 源文件 | SHA-256 |
|---|---|
| ${files.candidateQueue} | \`${hashes.candidateQueue}\` |
| ${files.goldV1} | \`${hashes.goldV1}\` |
| ${files.goldV2} | \`${hashes.goldV2}\` |

## 人工标签分布

### 当前性

| 标签 | 数量 |
|---|---:|
${markdownTable(countBy(goldRows, (row) => row.humanCurrentSymptom))}

### 咨询意图

| 标签 | 数量 |
|---|---:|
${markdownTable(countBy(goldRows, (row) => row.humanIntent))}

人工最终标签包含腹痛 ${goldRows.filter((row) => splitLabels(row.humanFinalComplaint).has('abdominal_pain')).length}/${goldRows.length}；多标签较多，不能把“包含腹痛”解释成单一腹痛。

## 边界信号（可重叠）

| 边界 | 数量 | 说明 |
|---|---:|---|
| 当前肯定腹痛（严格人工定义） | ${strictCurrent} | 产品正例基础 |
| 否定腹痛 | ${boundary.negated} | 不得写入当前槽位 |
| 历史腹痛 | ${boundary.historical} | 不得写入当前槽位 |
| 已缓解腹痛 | ${boundary.resolved} | 可整理本次经过，但标记resolved |
| 假设或疾病知识 | ${boundary.hypothetical} | 不等于当前症状预问诊 |
| 模板/错配 | ${boundary.invalid} | 需判断文本有效性 |
| 儿童或孕产妇 | ${boundary.unsupported} | 当前成人产品不支持 |
| 腹胀、恶心、反酸、胃部不适等相邻表达 | ${boundary.adjacent} | 没有疼痛证据时不得补写腹痛 |
| 腰痛、胸痛、经期不适等非目标疼痛 | ${boundary.nonTarget} | “痛”不能跨部位泛化 |

意图层风险：已确诊随访 ${goldRows.filter((row) => row.humanIntent === 'diagnosed_followup').length}，问药 ${goldRows.filter((row) => row.humanIntent === 'medication_query').length}，报告解读 ${goldRows.filter((row) => row.humanIntent === 'report_interpretation').length}，医院/费用 ${goldRows.filter((row) => row.humanIntent === 'hospital_or_cost').length}。

## 主要边界问题

1. 正例占比高：严格当前腹痛为 ${strictCurrent}/${goldRows.length}；否定、历史、已缓解和纯相邻表达的人工负例不足。
2. 既有标签包含疾病知识、随访、问药、医院费用和不支持人群，字面命中不能替代意图路由。
3. 最终标签经常为多主诉组合，未来规则不能强压成单标签。
4. 腹胀、恶心、反酸、胃部不适既可共现也可独立出现，没有疼痛证据时不得自动补写腹痛。
5. 高风险表达需要独立人工字段与未来确定性规则，不能由疾病推断代替。

## 定向抽样结果

固定随机种子：\`${seed}\`。

| 分层 | 数量 |
|---|---:|
${markdownTable(countBy(selections, (row) => row.stratum))}

- 总计：${selections.length} 条；review_id、source_row_id、规范化 title+ask 均唯一。
- 与 gold_v1/gold_v2 的 review_id、source_row 和规范化 title+ask 重合：0。
- 人工字段初始非空：0。
- 可用相邻表达硬负例共 ${broaderAdjacent.length} 条，来自尚未进入gold的更广泛患者侧候选池；剩余腹痛字面候选没有足够的“未明确疼痛”记录。队列选取其中4条并用 \`sampling_reason\` 标记，避免伪装覆盖。
- 排除gold的source_row与文本后，原腹痛字面池只有1条不支持人群记录；队列从 ${broaderUnsupported.length} 条“明确腹痛+不支持人群”的更广泛未入gold候选中补足第2条。
- CSV 不包含医生answer。

## 开发门禁

人工审核完成后才计算：20条全部完成；当前腹痛与非腹痛边界一致率≥85%；否定/历史/已缓解误写当前=0；不支持人群误入成人流程=0；高风险漏标=0；无重大标签歧义。未达到时只补具体缺口，不重新随机120条。
`
}

function validateQueue(rows, config, goldRows, { requireBlankHumanFields = true } = {}) {
  const expectedTotal = Object.values(config.strata).reduce((sum, value) => sum + value, 0)
  if (rows.length !== expectedTotal || expectedTotal !== 20) throw new Error(`queue_size_invalid:${rows.length}/${expectedTotal}`)
  const ids = rows.map((row) => row.review_id)
  const sources = rows.map((row) => String(row.source_row_id))
  const fingerprints = rows.map((row) => sha256Text(`${normalizedText(row.title)}|${normalizedText(row.ask)}`))
  if (new Set(ids).size !== rows.length) throw new Error('queue_review_id_duplicate')
  if (new Set(sources).size !== rows.length) throw new Error('queue_source_row_duplicate')
  if (new Set(fingerprints).size !== rows.length) throw new Error('queue_text_duplicate')
  if (rows.some((row) => row.candidate_complaint !== 'abdominal_pain')) throw new Error('queue_complaint_invalid')
  if (requireBlankHumanFields && rows.some((row) => HUMAN_FIELDS.some((field) => String(row[field] ?? '').trim()))) throw new Error('queue_human_fields_not_blank')
  const goldSources = new Set(goldRows.map((row) => String(row.source_row)))
  const goldFingerprints = new Set(goldRows.map(fingerprint))
  if (rows.some((row) => goldSources.has(String(row.source_row_id)) || goldFingerprints.has(sha256Text(`${normalizedText(row.title)}|${normalizedText(row.ask)}`)))) throw new Error('queue_gold_overlap')
  const counts = countBy(rows, (row) => row.sampling_reason)
  for (const [label, count] of Object.entries(config.strata)) if (counts[label] !== count) throw new Error(`queue_stratum_invalid:${label}`)
  if (OUTPUT_FIELDS.some((field) => ['answer', 'original_answer', 'doctor_answer'].includes(field))) throw new Error('queue_answer_field_forbidden')
  return counts
}

async function readCsv(path) {
  const text = await readFile(path, 'utf8')
  return { text, rows: parseCsv(text) }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  const dataRoot = resolve(args.dataRoot || resolve(PROJECT_ROOT, config.dataProjectRelativePath))
  const outputDir = resolve(args.outputDir || PROJECT_ROOT)
  const files = Object.fromEntries(Object.entries(config.sourceFiles).map(([key, value]) => [key, resolve(dataRoot, value)]))
  const outputs = Object.fromEntries(Object.entries(config.outputs).map(([key, value]) => [key, resolve(outputDir, value)]))
  const candidateFile = await readCsv(files.candidateQueue)
  const goldV1File = await readCsv(files.goldV1)
  const goldV2File = await readCsv(files.goldV2)
  const goldRows = [
    ...goldV1File.rows.filter((row) => row.candidate_complaint === 'abdominal_pain').map((row) => normalizeGold(row, 'gold_v1')),
    ...goldV2File.rows.filter((row) => row.candidate_complaint === 'abdominal_pain').map((row) => normalizeGold(row, 'gold_v2')),
  ]
  if (goldRows.length !== 30 || new Set(goldRows.map((row) => row.review_id)).size !== 30) throw new Error('gold_abdominal_expected_30_unique')
  const allGold = [...goldV1File.rows, ...goldV2File.rows]
  const goldIds = new Set(allGold.map((row) => row.review_id))
  const goldSources = new Set(allGold.map((row) => String(row.source_row)))
  const goldFingerprints = new Set(allGold.map(fingerprint))
  const unGold = candidateFile.rows.filter((row) => !goldIds.has(row.review_id) && !goldSources.has(String(row.source_row)) && !goldFingerprints.has(fingerprint(row)))
  const untouchedAbdominal = unGold.filter((row) => row.candidate_complaint === 'abdominal_pain')
  const broaderAdjacent = unGold.filter((row) => ADJACENT_EXPRESSION.test(patientText(row)) && !ABDOMINAL_PAIN.test(patientText(row)))
  const broaderUnsupported = unGold.filter((row) => hasUnsupportedPopulation(row) && ABDOMINAL_PAIN.test(patientText(row)))

  let queueRows
  if (existsSync(outputs.targetedReview)) {
    queueRows = (await readCsv(outputs.targetedReview)).rows
    validateQueue(queueRows, config, goldRows, { requireBlankHumanFields: false })
    if (!args.check) console.info('EXISTS: targeted review queue preserved; no overwrite performed.')
  } else {
    if (args.check) throw new Error('targeted_review_missing')
    const usedIds = new Set(); const usedFingerprints = new Set(); const chosen = []
    const pools = {
      current_affirmed: untouchedAbdominal.filter((row) => ABDOMINAL_PAIN.test(patientText(row)) && !hasNonCurrentContext(row) && !hasInvalidOrMismatch(row) && !hasUnsupportedPopulation(row) && !hasCurrentRisk(row)),
      negated_historical_resolved: untouchedAbdominal.filter(hasNonCurrentContext),
      adjacent_expression_without_pain: broaderAdjacent,
      mismatch_template_invalid: untouchedAbdominal.filter(hasInvalidOrMismatch),
      unsupported_population: broaderUnsupported,
      possible_risk_expression: untouchedAbdominal.filter(hasCurrentRisk),
    }
    for (const [stratum, count] of Object.entries(config.strata)) {
      deterministicSample(pools[stratum], count, config.samplingSeed, stratum, usedIds, usedFingerprints).forEach((source) => chosen.push({ source, stratum }))
    }
    queueRows = chosen.map(({ source, stratum }, index) => ({
      review_id: `ABD-TARGET-${String(index + 1).padStart(3, '0')}`,
      source_row_id: source.source_row,
      title: source.original_title,
      ask: source.original_ask,
      candidate_complaint: 'abdominal_pain',
      sampling_reason: stratum,
      human_is_valid: '', human_current_symptom: '', human_final_complaint: '', human_intent: '', human_risk_expression: '', human_notes: '',
      stratum,
    }))
    validateQueue(queueRows, config, goldRows)
    await mkdir(dirname(outputs.targetedReview), { recursive: true })
    await writeFile(outputs.targetedReview, encodeCsv(queueRows), 'utf8')
  }

  const report = createAuditReport({
    files: config.sourceFiles, goldRows, untouchedAbdominal, broaderAdjacent, broaderUnsupported,
    selections: queueRows.map((row) => ({ ...row, stratum: row.sampling_reason })), seed: config.samplingSeed,
    hashes: { candidateQueue: sha256Text(candidateFile.text), goldV1: sha256Text(goldV1File.text), goldV2: sha256Text(goldV2File.text) },
  })
  await mkdir(dirname(outputs.auditReport), { recursive: true })
  await writeFile(outputs.auditReport, report, 'utf8')
  console.info(JSON.stringify({
    queueRows: queueRows.length, strata: validateQueue(queueRows, config, goldRows, { requireBlankHumanFields: false }),
    duplicateReviewIds: 0, duplicateSourceRows: 0, duplicateNormalizedTexts: 0,
    goldOverlap: 0,
    nonBlankHumanFields: queueRows.filter((row) => HUMAN_FIELDS.some((field) => String(row[field] ?? '').trim())).length,
    doctorAnswerFields: 0, samplingSeed: config.samplingSeed,
  }, null, 2))
}

await main()
