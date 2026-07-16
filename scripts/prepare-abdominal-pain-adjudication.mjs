import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = resolve(PROJECT_ROOT, 'config', 'abdominal-pain-adjudication.json')

const SOURCE_FIELDS = ['review_id', 'source_row_id', 'title', 'ask', 'candidate_complaint']

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
  const headers = records[0].map((value, index) => index === 0 ? value.replace(/^\uFEFF/, '') : value)
  return {
    headers,
    rows: records.slice(1).filter((values) => values.some(Boolean)).map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))),
  }
}

function encodeCsv(rows, fields) {
  const escape = (value) => {
    const text = String(value ?? '')
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  return `\uFEFF${[fields, ...rows.map((row) => fields.map((field) => row[field] ?? ''))].map((row) => row.map(escape).join(',')).join('\r\n')}\r\n`
}

function validateAdjudication(headers, rows, config, { requireBlank = false } = {}) {
  const expectedFields = [...SOURCE_FIELDS, ...config.secondRoundFields, ...config.finalFields]
  if (headers.join('|') !== expectedFields.join('|')) throw new Error('adjudication_headers_invalid')
  if (rows.length !== 7) throw new Error(`adjudication_expected_7:${rows.length}`)
  const ids = rows.map((row) => row.review_id)
  if (new Set(ids).size !== 7 || ids.join('|') !== config.reviewIds.join('|')) throw new Error('adjudication_ids_invalid')
  if (rows.some((row) => row.candidate_complaint !== 'abdominal_pain')) throw new Error('adjudication_candidate_invalid')
  if (headers.some((field) => ['answer', 'doctor_answer', 'sampling_reason', 'human_current_symptom'].includes(field))) throw new Error('blindness_field_forbidden')
  if (requireBlank && rows.some((row) => [...config.secondRoundFields, ...config.finalFields].some((field) => String(row[field]).trim()))) throw new Error('adjudication_labels_not_blank')
}

async function main() {
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
  const sourcePath = resolve(PROJECT_ROOT, config.sourceCsv)
  const outputPath = resolve(PROJECT_ROOT, config.outputCsv)
  const sourceText = await readFile(sourcePath, 'utf8')
  const sourceHash = sha256(sourceText)
  if (sourceHash !== config.sourceSha256) throw new Error(`source_hash_mismatch:${sourceHash}`)
  const source = parseCsv(sourceText)
  const sourceById = new Map(source.rows.map((row) => [row.review_id, row]))
  if (config.reviewIds.some((reviewId) => !sourceById.has(reviewId))) throw new Error('source_review_id_missing')

  if (existsSync(outputPath)) {
    const existing = parseCsv(await readFile(outputPath, 'utf8'))
    validateAdjudication(existing.headers, existing.rows, config)
    console.info(JSON.stringify({ status: 'preserved', rows: existing.rows.length, sourceSha256: sourceHash }, null, 2))
    return
  }

  const fields = [...SOURCE_FIELDS, ...config.secondRoundFields, ...config.finalFields]
  const rows = config.reviewIds.map((reviewId) => {
    const sourceRow = sourceById.get(reviewId)
    return Object.fromEntries(fields.map((field) => [field, SOURCE_FIELDS.includes(field) ? sourceRow[field] : '']))
  })
  validateAdjudication(fields, rows, config, { requireBlank: true })
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, encodeCsv(rows, fields), 'utf8')
  if (sha256(await readFile(sourcePath, 'utf8')) !== sourceHash) throw new Error('source_changed')
  console.info(JSON.stringify({
    status: 'created', rows: rows.length, uniqueReviewIds: new Set(rows.map((row) => row.review_id)).size,
    blankSecondRound: 7, blankFinal: 7, doctorAnswerFields: 0, sourceSha256: sourceHash,
  }, null, 2))
}

await main()
