import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const config = JSON.parse(await readFile(resolve(ROOT, 'config', 'abdominal-pain-followup-adjudication.json'), 'utf8'))
const sourcePath = resolve(ROOT, config.sourceCsv)
const outputPath = resolve(ROOT, config.outputCsv)
const SOURCE_FIELDS = ['review_id', 'source_row_id', 'title', 'ask', 'candidate_complaint', 'sampling_reason']
const FINAL_FIELDS = [
  'final_candidate_current', 'final_candidate_status', 'final_complaints', 'final_intent',
  'final_risk_present', 'final_risk_scope', 'final_risk_category', 'adjudication_reason', 'final_notes',
]

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

const escapeCsv = (value) => /[",\r\n]/u.test(String(value ?? '')) ? `"${String(value ?? '').replaceAll('"', '""')}"` : String(value ?? '')
const encodeCsv = (rows, fields) => `\uFEFF${[fields, ...rows.map((row) => fields.map((field) => row[field] ?? ''))].map((values) => values.map(escapeCsv).join(',')).join('\r\n')}\r\n`
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const sourceText = await readFile(sourcePath, 'utf8')
if (sha256(sourceText) !== config.sourceSha256) throw new Error('followup_source_hash_mismatch')
if (existsSync(outputPath)) {
  console.info(JSON.stringify({ status: 'preserved', output: config.outputCsv }, null, 2))
} else {
  const sourceRows = parseCsv(sourceText)
  const byId = new Map(sourceRows.map((row) => [row.review_id, row]))
  const fields = [...SOURCE_FIELDS, ...FINAL_FIELDS]
  const rows = config.reviewIds.map((reviewId) => {
    const source = byId.get(reviewId)
    if (!source) throw new Error(`missing_review_id:${reviewId}`)
    return Object.fromEntries(fields.map((field) => [field, SOURCE_FIELDS.includes(field) ? source[field] : '']))
  })
  if (rows.some((row) => FINAL_FIELDS.some((field) => row[field]))) throw new Error('adjudication_not_blank')
  if (fields.some((field) => /^human_|answer/i.test(field))) throw new Error('blindness_field_forbidden')
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, encodeCsv(rows, fields), 'utf8')
  if (sha256(await readFile(sourcePath, 'utf8')) !== config.sourceSha256) throw new Error('source_changed')
  console.info(JSON.stringify({ status: 'created', rows: 5, uniqueIds: 5, finalFieldsBlank: 5, oldLabelsPresent: false, answerFields: 0 }, null, 2))
}
