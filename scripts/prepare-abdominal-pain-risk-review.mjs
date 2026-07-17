import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const config = JSON.parse(await readFile(resolve(ROOT, 'config', 'abdominal-pain-risk-review.json'), 'utf8'))
const FIELDS = [
  'review_id', 'source_row_id', 'title', 'ask', 'candidate_complaint', 'sampling_reason',
  'human_risk_present', 'human_risk_status', 'human_risk_scope', 'human_risk_category', 'human_notes',
]
const HUMAN_FIELDS = FIELDS.slice(6)
const ABDOMINAL = /腹痛|肚子(?:疼|痛)|胃(?:疼|痛)|小腹(?:疼|痛)|上腹(?:疼|痛)|下腹(?:疼|痛)|腹部[^，。；]{0,5}(?:疼|痛)/u
const ABDOMINAL_RISK = /(?:突然|剧烈)[^，。；]{0,12}(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))|(?:腹痛|肚子(?:疼|痛)|胃(?:疼|痛))[^，。；]{0,12}(?:突然|剧烈)|呕血|吐血|黑便|便血|大便带血|无法排便|不能排便|无法排气|不能排气|晕厥|意识不清|昏迷|喘不上气|严重呼吸困难/u
const GLOBAL_RISK = /咯血|血尿|尿血|血痰|(?:痰中|痰里|痰液|吐痰|咳痰)[^，。；]{0,8}(?:带血|有血|血丝)/u
const ANY_RISK = new RegExp(`${ABDOMINAL_RISK.source}|${GLOBAL_RISK.source}`, 'u')
const NEGATION_CUE = /没有|无|否认|未出现|不伴|并无|未见|不严重/u
const NON_CURRENT_CUE = /以前|之前|曾经|去年|小时候|多年前|当时|如果|假如|会不会|担心|可能|是否/u

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

const hash = (value) => createHash('sha256').update(value).digest('hex')
const normalized = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').replace(/[，。！？；：,.!?;:'"“”‘’（）()【】\[\]]/gu, '')
const fingerprint = (row, title = 'title', ask = 'ask') => hash(`${normalized(row[title])}|${normalized(row[ask])}`)
const textOf = (row) => `${row.title ?? ''} ${row.ask ?? ''}`
const escapeCsv = (value) => /[",\r\n]/u.test(String(value ?? '')) ? `"${String(value ?? '').replaceAll('"', '""')}"` : String(value ?? '')
const encodeCsv = (rows) => `\uFEFF${[FIELDS, ...rows.map((row) => FIELDS.map((field) => row[field] ?? ''))].map((values) => values.map(escapeCsv).join(',')).join('\r\n')}\r\n`

function rng(seed) { let state = seed >>> 0; return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296 } }
function take(pool, count, label, used) {
  const random = rng(createHash('sha256').update(`${config.samplingSeed}:${label}`).digest().readUInt32LE(0))
  const eligible = pool.filter((row) => !used.has(fingerprint(row))).sort((a, b) => a.source_row_id.localeCompare(b.source_row_id, 'en'))
  for (let index = eligible.length - 1; index > 0; index -= 1) { const swap = Math.floor(random() * (index + 1)); [eligible[index], eligible[swap]] = [eligible[swap], eligible[index]] }
  if (eligible.length < count) throw new Error(`insufficient_stratum:${label}:${eligible.length}/${count}`)
  const selected = eligible.slice(0, count); selected.forEach((row) => used.add(fingerprint(row))); return selected
}

const candidatePath = resolve(ROOT, config.candidateQueue)
const candidateText = await readFile(candidatePath, 'utf8')
const candidateHash = hash(candidateText)
const candidates = parseCsv(candidateText).filter((row) => row.candidate_complaint === 'abdominal_pain').map((row) => ({
  source_row_id: String(row.source_row), title: row.original_title ?? '', ask: row.original_ask ?? '',
}))
const previousRows = (await Promise.all(config.previousFiles.map((file) => readFile(resolve(ROOT, file), 'utf8').then(parseCsv)))).flat()
const excluded = new Set(previousRows.map((row) => fingerprint(row)))
const base = candidates.filter((row) => !excluded.has(fingerprint(row)) && ABDOMINAL.test(textOf(row)))
const pools = {
  abdominal_specific_current: base.filter((row) => ABDOMINAL_RISK.test(textOf(row)) && !NEGATION_CUE.test(textOf(row)) && !NON_CURRENT_CUE.test(textOf(row))),
  global_other_current: base.filter((row) => GLOBAL_RISK.test(textOf(row)) && !NEGATION_CUE.test(textOf(row)) && !NON_CURRENT_CUE.test(textOf(row))),
  negated_risk: base.filter((row) => NEGATION_CUE.test(textOf(row)) && ANY_RISK.test(textOf(row))),
  historical_or_hypothetical_risk: base.filter((row) => NON_CURRENT_CUE.test(textOf(row)) && ANY_RISK.test(textOf(row))),
}
const outputPath = resolve(ROOT, config.outputCsv)
if (existsSync(outputPath)) throw new Error('risk_review_exists_refusing_overwrite')
const used = new Set(excluded); const selected = []
for (const [label, count] of Object.entries(config.strata)) take(pools[label], count, label, used).forEach((row) => selected.push({ row, label }))
const rows = selected.map(({ row, label }, index) => ({
  review_id: `ABD-RISK-${String(index + 1).padStart(3, '0')}`, source_row_id: row.source_row_id,
  title: row.title, ask: row.ask, candidate_complaint: 'abdominal_pain', sampling_reason: label,
  human_risk_present: '', human_risk_status: '', human_risk_scope: '', human_risk_category: '', human_notes: '',
}))
if (rows.length !== 6 || new Set(rows.map((row) => row.review_id)).size !== 6 || rows.some((row) => HUMAN_FIELDS.some((field) => row[field]))) throw new Error('risk_queue_invalid')
if (FIELDS.some((field) => /answer/i.test(field))) throw new Error('answer_field_forbidden')
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, encodeCsv(rows), 'utf8')
if (hash(await readFile(candidatePath, 'utf8')) !== candidateHash) throw new Error('candidate_source_changed')
const counts = Object.fromEntries(Object.keys(config.strata).map((label) => [label, rows.filter((row) => row.sampling_reason === label).length]))
await writeFile(resolve(ROOT, config.manifest), `# 腹痛风险定向复核清单\n\n> 聚合清单不含患者全文；患者侧title/ask位于Git忽略CSV。数据源自身不含医生answer列。\n\n- 固定种子：\`${config.samplingSeed}\`\n- 总数：6\n- 与gold、首批20条及补充8条按规范化文本重合：0\n- 治理后候选CSV运行前后SHA-256：\`${candidateHash}\`（一致）\n\n| 分层 | 数量 |\n|---|---:|\n${Object.entries(counts).map(([label, count]) => `| \`${label}\` | ${count} |`).join('\n')}\n`, 'utf8')
console.info(JSON.stringify({ rows: 6, strata: counts, overlap: 0, humanFieldsBlank: 6, answerFields: 0 }, null, 2))
