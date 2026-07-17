import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const SOURCE = resolve(ROOT, 'reports', 'abdominal-pain-followup-adjudication.csv')
const OUTPUT = resolve(ROOT, 'reports', 'abdominal-pain-followup-adjudication-ai-provisional.csv')
const sourceHashBefore = createHash('sha256').update(await readFile(SOURCE)).digest('hex')
const fields = [
  'review_id', 'reviewer_type', 'ai_candidate_current', 'ai_candidate_status', 'ai_complaints',
  'ai_intent', 'ai_risk_present', 'ai_risk_scope', 'ai_risk_category',
  'ai_adjudication_reason', 'ai_notes', 'needs_human_confirmation',
]
const rows = [
  {
    review_id: 'ABD-FOLLOWUP-001', reviewer_type: 'ai', ai_candidate_current: 'yes', ai_candidate_status: 'current',
    ai_complaints: 'abdominal_pain|other', ai_intent: 'diagnosed_followup', ai_risk_present: 'no',
    ai_risk_scope: 'none', ai_risk_category: 'none', ai_adjudication_reason: 'intent_scope_reviewed',
    ai_notes: '当前腹痛及其他消化道表达明确；标题含既有疾病称谓和饮食咨询，AI暂定为随访意图。', needs_human_confirmation: 'true',
  },
  {
    review_id: 'ABD-FOLLOWUP-002', reviewer_type: 'ai', ai_candidate_current: 'yes', ai_candidate_status: 'current',
    ai_complaints: 'abdominal_pain|other', ai_intent: 'diagnosed_followup', ai_risk_present: 'no',
    ai_risk_scope: 'none', ai_risk_category: 'none', ai_adjudication_reason: 'chronic_current_with_followup',
    ai_notes: '长期反复且近期仍有腹痛描述，并包含既往检查及治疗经过。', needs_human_confirmation: 'true',
  },
  {
    review_id: 'ABD-FOLLOWUP-003', reviewer_type: 'ai', ai_candidate_current: 'yes', ai_candidate_status: 'current',
    ai_complaints: 'fever|cough|abdominal_pain', ai_intent: 'pediatric_or_pregnancy', ai_risk_present: 'no',
    ai_risk_scope: 'none', ai_risk_category: 'none', ai_adjudication_reason: 'unsupported_population_routed',
    ai_notes: '当前腹痛与伴随表达明确，但孕产妇应路由到不支持人群；未达到冻结的腹胀且无法排便排气风险组合。', needs_human_confirmation: 'true',
  },
  {
    review_id: 'ABD-FOLLOWUP-004', reviewer_type: 'ai', ai_candidate_current: 'yes', ai_candidate_status: 'current',
    ai_complaints: 'abdominal_pain', ai_intent: 'pediatric_or_pregnancy', ai_risk_present: 'no',
    ai_risk_scope: 'none', ai_risk_category: 'none', ai_adjudication_reason: 'title_fallback_unsupported_population',
    ai_notes: 'ask无效但title可作为完整回退文本；孕期腹痛进入不支持人群，不进入成人流程。', needs_human_confirmation: 'true',
  },
  {
    review_id: 'ABD-FOLLOWUP-005', reviewer_type: 'ai', ai_candidate_current: 'uncertain', ai_candidate_status: 'uncertain',
    ai_complaints: 'uncertain', ai_intent: 'invalid_or_template', ai_risk_present: 'uncertain',
    ai_risk_scope: 'uncertain', ai_risk_category: 'other', ai_adjudication_reason: 'concatenated_template_invalid',
    ai_notes: '患者侧字段包含多条无关记录拼接，无法可靠确定候选当前性、主诉或风险主体。', needs_human_confirmation: 'true',
  },
]
const escapeCsv = (value) => /[",\r\n]/u.test(String(value ?? '')) ? `"${String(value ?? '').replaceAll('"', '""')}"` : String(value ?? '')
const csv = `\uFEFF${[fields, ...rows.map((row) => fields.map((field) => row[field]))].map((values) => values.map(escapeCsv).join(',')).join('\r\n')}\r\n`
await writeFile(OUTPUT, csv, 'utf8')
const sourceHashAfter = createHash('sha256').update(await readFile(SOURCE)).digest('hex')
if (sourceHashAfter !== sourceHashBefore) throw new Error('human_adjudication_source_changed')
console.info(JSON.stringify({ rows: rows.length, reviewerType: 'ai', needsHumanConfirmation: rows.length, humanOrFinalFieldsWritten: 0, sourceHashUnchanged: true }, null, 2))
