import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = resolve(ROOT, 'config', 'abdominal-pain-followup-review.json')
const FIELDS = [
  'review_id', 'source_row_id', 'title', 'ask', 'candidate_complaint', 'sampling_reason',
  'human_candidate_current', 'human_candidate_status', 'human_candidate_complaints',
  'human_candidate_intent', 'human_risk_present', 'human_risk_scope',
  'human_risk_category', 'human_notes',
]
const HUMAN_FIELDS = FIELDS.slice(6)
const ABDOMINAL = /腹痛|肚子(?:疼|痛)|胃(?:疼|痛)|小腹(?:疼|痛)|上腹(?:疼|痛)|下腹(?:疼|痛)|腹部[^，。；]{0,5}(?:疼|痛)/u
const NON_CURRENT = /没有|无|否认|不伴|未出现|不疼|不痛|以前|之前|曾经|去年|小时候|多年前|前段时间|缓解|好了|恢复正常|消失|如果|假如|会不会|是什么|什么原因|如何预防/u
const CURRENT_CUE = /现在|目前|今天|这两天|这几天|最近|仍然|仍在|一直|又|再次|持续/u
const UNSUPPORTED = /宝宝|婴儿|幼儿|小孩|儿童|男童|女童|孕妇|怀孕|孕周|产后|哺乳期|恶露|(?<!\d)(?:[0-9]|1[0-7])\s*岁/u
const GLOBAL_RISK = /咯血|血尿|尿血|血痰|(?:痰中|痰里|痰液|吐痰|咳痰)[^，。；]{0,8}(?:带血|有血|血丝)/u
const AMBIGUOUS = /不确定|不知道|说不清|不太清楚|好像|可能|似乎|有点|偶尔|是不是/u

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
  if (quoted) throw new Error('csv_unclosed_quote')
  if (field || row.length) { row.push(field.replace(/\r$/u, '')); records.push(row) }
  const headers = records[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/u, '') : value)
  return records.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

const escapeCsv = (value) => /[",\r\n]/u.test(String(value ?? ''))
  ? `"${String(value ?? '').replaceAll('"', '""')}"` : String(value ?? '')
const encodeCsv = (rows) => `\uFEFF${[FIELDS, ...rows.map((row) => FIELDS.map((field) => row[field] ?? ''))]
  .map((values) => values.map(escapeCsv).join(',')).join('\r\n')}\r\n`
const normalized = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/gu, '').replace(/[，。！？；：,.!?;:'"“”‘’（）()【】\[\]]/gu, '')
const hash = (value) => createHash('sha256').update(value).digest('hex')
const fingerprint = (row, title = 'original_title', ask = 'original_ask') => hash(`${normalized(row[title])}|${normalized(row[ask])}`)
const textOf = (row) => `${row.original_title ?? ''} ${row.original_ask ?? ''}`

function random(seed) {
  let state = seed >>> 0
  return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296 }
}

function sample(pool, count, seed, label, usedSources, usedFingerprints) {
  const eligible = pool.filter((row) => !usedSources.has(String(row.source_row)) && !usedFingerprints.has(fingerprint(row)))
    .sort((a, b) => String(a.review_id).localeCompare(String(b.review_id), 'en'))
  const rng = random(createHash('sha256').update(`${seed}:${label}`).digest().readUInt32LE(0))
  for (let index = eligible.length - 1; index > 0; index -= 1) { const swap = Math.floor(rng() * (index + 1)); [eligible[index], eligible[swap]] = [eligible[swap], eligible[index]] }
  if (eligible.length < count) throw new Error(`insufficient_stratum:${label}:${eligible.length}/${count}`)
  const selected = eligible.slice(0, count)
  selected.forEach((row) => { usedSources.add(String(row.source_row)); usedFingerprints.add(fingerprint(row)) })
  return selected
}

function validate(rows, strata, priorRows, goldRows) {
  if (rows.length !== 8 || new Set(rows.map((row) => row.review_id)).size !== 8) throw new Error('followup_rows_invalid')
  if (rows.some((row) => HUMAN_FIELDS.some((field) => String(row[field] ?? '').trim()))) throw new Error('human_fields_not_blank')
  if (FIELDS.some((field) => /answer/i.test(field))) throw new Error('doctor_answer_field_forbidden')
  const priorSources = new Set([...priorRows, ...goldRows].map((row) => String(row.source_row_id || row.source_row)))
  const priorFingerprints = new Set([
    ...priorRows.map((row) => fingerprint(row, 'title', 'ask')),
    ...goldRows.map((row) => fingerprint(row)),
  ])
  if (rows.some((row) => priorSources.has(String(row.source_row_id)) || priorFingerprints.has(fingerprint(row, 'title', 'ask')))) throw new Error('prior_overlap')
  const counts = Object.fromEntries(Object.keys(strata).map((label) => [label, rows.filter((row) => row.sampling_reason === label).length]))
  for (const [label, count] of Object.entries(strata)) if (counts[label] !== count) throw new Error(`stratum_invalid:${label}`)
  return counts
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG, 'utf8'))
  const dataRoot = resolve(ROOT, config.dataProjectRelativePath)
  const paths = {
    candidates: resolve(dataRoot, config.candidateQueue), gold1: resolve(dataRoot, config.goldV1),
    gold2: resolve(dataRoot, config.goldV2), raw: resolve(dataRoot, config.rawSourceCsv), prior: resolve(ROOT, config.previousReview),
    output: resolve(ROOT, config.outputCsv), manifest: resolve(ROOT, config.manifest),
  }
  const [candidates, gold1, gold2, prior, rawBuffer] = await Promise.all([
    readFile(paths.candidates, 'utf8').then(parseCsv), readFile(paths.gold1, 'utf8').then(parseCsv),
    readFile(paths.gold2, 'utf8').then(parseCsv), readFile(paths.prior, 'utf8').then(parseCsv),
    readFile(paths.raw),
  ])
  if (existsSync(paths.output)) throw new Error('followup_queue_exists_refusing_overwrite')
  const gold = [...gold1, ...gold2]
  const usedIds = new Set([...gold, ...prior].map((row) => row.review_id))
  const usedSources = new Set([...gold, ...prior].map((row) => String(row.source_row_id || row.source_row)))
  const usedFingerprints = new Set([
    ...gold.map((row) => fingerprint(row)), ...prior.map((row) => fingerprint(row, 'title', 'ask')),
  ])
  const rawHashBefore = hash(rawBuffer)
  const rawRows = parseCsv(new TextDecoder('gb18030', { fatal: true }).decode(rawBuffer)).map((row, index) => ({
    review_id: `RAW-IM-${index + 2}`, source_row: `raw-im-${index + 2}`,
    original_title: row.title ?? '', original_ask: row.ask ?? '',
  }))
  const combined = [...candidates, ...rawRows]
  const base = combined.filter((row) => !usedIds.has(row.review_id) && !usedSources.has(String(row.source_row)) && !usedFingerprints.has(fingerprint(row)))
  const pools = {
    implicit_current_boundary: base.filter((row) => ABDOMINAL.test(textOf(row)) && !NON_CURRENT.test(textOf(row)) && !CURRENT_CUE.test(textOf(row)) && !UNSUPPORTED.test(textOf(row)) && !GLOBAL_RISK.test(textOf(row)) && !AMBIGUOUS.test(textOf(row))),
    unsupported_population: base.filter((row) => ABDOMINAL.test(textOf(row)) && UNSUPPORTED.test(textOf(row))),
    global_other_risk_routing: base.filter((row) => ABDOMINAL.test(textOf(row)) && GLOBAL_RISK.test(textOf(row))),
    ambiguous_current_or_risk: base.filter((row) => ABDOMINAL.test(textOf(row)) && AMBIGUOUS.test(textOf(row)) && !UNSUPPORTED.test(textOf(row)) && !GLOBAL_RISK.test(textOf(row))),
  }
  const chosen = []; const selectedSources = new Set(usedSources); const selectedFingerprints = new Set(usedFingerprints)
  for (const [label, count] of Object.entries(config.strata)) sample(pools[label], count, config.samplingSeed, label, selectedSources, selectedFingerprints)
    .forEach((row) => chosen.push({ row, label }))
  const rows = chosen.map(({ row, label }, index) => ({
    review_id: `ABD-FOLLOWUP-${String(index + 1).padStart(3, '0')}`, source_row_id: row.source_row,
    title: row.original_title, ask: row.original_ask, candidate_complaint: 'abdominal_pain', sampling_reason: label,
    human_candidate_current: '', human_candidate_status: '', human_candidate_complaints: '', human_candidate_intent: '',
    human_risk_present: '', human_risk_scope: '', human_risk_category: '', human_notes: '',
  }))
  const counts = validate(rows, config.strata, prior, gold)
  await mkdir(dirname(paths.output), { recursive: true })
  await writeFile(paths.output, encodeCsv(rows), 'utf8')
  const rawHashAfter = hash(await readFile(paths.raw))
  if (rawHashAfter !== rawHashBefore) throw new Error('raw_source_changed')
  const manifest = `# 腹痛门禁补充复核队列\n\n> 仅包含聚合信息；患者侧文本位于Git忽略的CSV中。原始CSV仅取title/ask进入队列，医生answer不进入任何输出或规则。\n\n- 固定种子：\`${config.samplingSeed}\`\n- 总数：8\n- 与gold_v1、gold_v2及首批20条按review_id/source_row/规范化文本重合：0\n- 人工字段初始非空：0\n- 原始内科CSV运行前后SHA-256：\`${rawHashBefore}\`（一致）\n\n| 分层 | 数量 |\n|---|---:|\n${Object.entries(counts).map(([label, count]) => `| \`${label}\` | ${count} |`).join('\n')}\n\n该队列只用于澄清当前性、不支持人群、全局其他风险路由及语言歧义，不授权生产规则开发。\n`
  await writeFile(paths.manifest, manifest, 'utf8')
  console.info(JSON.stringify({ rows: rows.length, strata: counts, overlap: 0, humanFieldsBlank: 8, answerFields: 0 }, null, 2))
}

await main()
