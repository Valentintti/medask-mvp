import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const INPUT = resolve(ROOT, 'reports', 'abdominal-pain-followup-review.csv')
const OUTPUT = resolve(ROOT, 'reports', 'abdominal-pain-followup-008-analysis.md')
const TERMS = /腹痛|肚子(?:疼|痛)|胃(?:疼|痛)|小腹(?:疼|痛)|上腹(?:疼|痛)|下腹(?:疼|痛)|腹部[^，。；]{0,5}(?:疼|痛)/gu
const HYPOTHETICAL = /如果|假如|会不会|是什么|有哪些症状|什么原因|为什么会|是否遗传|如何预防/u
const HISTORICAL = /以前|之前|曾经|去年|小时候|多年前|前段时间|当时|既往/u
const RESOLVED = /缓解|好了|不疼了|不痛了|恢复正常|恢复了|消失/u
const NEGATED = /没有|无|否认|不伴|未出现|不疼|不痛/u

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

const row = parseCsv(await readFile(INPUT, 'utf8')).find((item) => item.review_id === 'ABD-FOLLOWUP-008')
if (!row) throw new Error('followup_008_missing')
const text = `${row.title}。${row.ask}`.replace(/\s+/gu, '')
const clauses = text.split(/[，。！？；,!?;]|但|然而|不过/u).filter(Boolean)
const matches = [...text.matchAll(TERMS)].map((match) => match[0])
const states = clauses.filter((clause) => /腹痛|肚子(?:疼|痛)|胃(?:疼|痛)|小腹(?:疼|痛)|上腹(?:疼|痛)|下腹(?:疼|痛)/u.test(clause)).map((clause) =>
  HYPOTHETICAL.test(clause) ? 'hypothetical' : NEGATED.test(clause) ? 'negated' : RESOLVED.test(clause) ? 'resolved' : HISTORICAL.test(clause) ? 'historical' : 'current')
const finalStatus = row.human_candidate_status
const category = finalStatus === 'hypothetical' ? 'hypothetical_as_current'
  : finalStatus === 'historical' ? 'historical_as_current'
    : finalStatus === 'resolved' ? 'resolved_as_current'
      : finalStatus === 'negated' ? 'keyword_scope_error' : 'other'
const report = `# ABD-FOLLOWUP-008 假阳性脱敏分析\n\n> 不含患者全文、医生answer或模型输出；仅报告通用规则结构特征。\n\n| 项目 | 结果 |\n|---|---|\n| review_id | \`ABD-FOLLOWUP-008\` |\n| 规则命中的词 | ${[...new Set(matches)].map((value) => `\`${value}\``).join('、') || '无'} |\n| 规则局部上下文状态 | ${[...new Set(states)].map((value) => `\`${value}\``).join('、') || '`uncertain`'} |\n| 规则预测 | \`current/yes\` |\n| 最终人工标签 | \`${row.human_candidate_status}/${row.human_candidate_current}\` |\n| 假阳性类别 | \`${category}\` |\n\n## 根因\n\n候选词所在局部子句没有被现有草案识别为非当前，因此默认得到current；人工标签则将整句问题判为hypothetical。通用修复方向是把候选词局部状态与整句问法/咨询意图共同纳入当前性判定；不得为该review_id增加特例，也不得放宽人工门禁。\n`
await writeFile(OUTPUT, report, 'utf8')
console.info(JSON.stringify({ reviewId: row.review_id, matchedTermCount: new Set(matches).size, contextStates: [...new Set(states)], rulePrediction: 'current/yes', finalLabel: `${row.human_candidate_status}/${row.human_candidate_current}`, category }, null, 2))
