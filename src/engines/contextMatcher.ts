export interface TermOccurrence {
  term: string
  index: number
  negated: boolean
  contextStatus: ContextStatus
  context: string
}

export type ContextStatus =
  | 'asserted'
  | 'negated'
  | 'historical'
  | 'resolved'
  | 'hypothetical'

const CLAUSE_BOUNDARY = /(?:但是|然而|不过|可是|但|却|[，。！？；,.!?;])/u
const NEGATION_SCOPE = /(?:并?没有|无|否认|未出现|不伴有?|不存在|未见|并无|不)\s*[^，。！？；,.!?;]{0,8}$/u
const HISTORICAL_SCOPE = /(?:以前|去年|当时|小时候|曾经|之前|前段时间|过去|早些时候)[^，。！？；,.!?;]{0,12}$/u
const HYPOTHETICAL_SCOPE = /(?:如果|假如|万一|担心(?:以后)?|会不会|是否会|可能会|预防)[^，。！？；,.!?;]{0,12}$/u
const RESOLVED_CLAUSE = /(?:烧退了|退烧了|退热了|已经不(?:发烧|发热|咳嗽|胸痛|头痛|头疼|脑袋疼|头晕|发晕|眩晕)|(?:发热|发烧|咳嗽|胸痛|头痛|头疼|脑袋疼|后脑勺疼|太阳穴疼|头晕|发晕|眩晕|天旋地转|站不稳|走路发飘|症状).{0,10}(?:(?:已经|现在|目前)?(?:好了|消失|缓解|恢复)|不疼了|不晕了)|(?:现在|已经|目前)(?:完全)?好了|恢复正常(?:体温)?|已经恢复)/u
const RECURRENCE_SCOPE = /(?:又|再次|重新|复发|仍在|还在|依然|今天又|现在又)[^，。！？；,.!?;]{0,10}$/u

function localPrefix(text: string, index: number, windowSize = 16): string {
  const window = text.slice(Math.max(0, index - windowSize), index)
  const clauses = window.split(CLAUSE_BOUNDARY)
  return clauses.at(-1) ?? ''
}

function localClause(text: string, index: number, termLength: number, windowSize = 28): string {
  const startWindow = text.slice(Math.max(0, index - windowSize), index)
  const prefixParts = startWindow.split(CLAUSE_BOUNDARY)
  const prefix = prefixParts.at(-1) ?? ''
  const suffixWindow = text.slice(index + termLength, index + termLength + windowSize)
  const suffix = suffixWindow.split(CLAUSE_BOUNDARY)[0] ?? ''
  return `${prefix}${text.slice(index, index + termLength)}${suffix}`
}

export function classifyOccurrenceContext(
  text: string,
  index: number,
  termLength: number,
): { status: ContextStatus; context: string } {
  const prefix = localPrefix(text, index, 24)
  const clause = localClause(text, index, termLength)

  // 复发或“仍在”表示当前存在，优先于同一局部子句前面的缓解/历史词。
  if (RECURRENCE_SCOPE.test(prefix)) return { status: 'asserted', context: clause }
  if (RESOLVED_CLAUSE.test(clause)) return { status: 'resolved', context: clause }
  if (NEGATION_SCOPE.test(prefix)) return { status: 'negated', context: clause }
  if (HYPOTHETICAL_SCOPE.test(prefix)) return { status: 'hypothetical', context: clause }
  if (HISTORICAL_SCOPE.test(prefix)) return { status: 'historical', context: clause }
  return { status: 'asserted', context: clause }
}

export function findTermOccurrences(text: string, terms: string[]): TermOccurrence[] {
  const occurrences: TermOccurrence[] = []

  for (const term of [...new Set(terms)].sort((left, right) => right.length - left.length)) {
    let fromIndex = 0
    while (fromIndex < text.length) {
      const index = text.indexOf(term, fromIndex)
      if (index < 0) break
      const classified = classifyOccurrenceContext(text, index, term.length)
      occurrences.push({
        term,
        index,
        negated: classified.status === 'negated',
        contextStatus: classified.status,
        context: classified.context,
      })
      fromIndex = index + term.length
    }
  }

  return occurrences.sort((left, right) => left.index - right.index || right.term.length - left.term.length)
}

/**
 * 在完整原文中定位模型 evidence 的全部出现位置，并逐个分析局部语境。
 * 不直接分析 evidence 自身，避免模型缩短片段后绕过原文中的否定或时间状态。
 */
export function findEvidenceOccurrences(text: string, evidence: string): TermOccurrence[] {
  if (!evidence || !text.includes(evidence)) return []
  return findTermOccurrences(text, [evidence])
}

export function hasAffirmedTerm(
  text: string,
  terms: string[],
  exclude?: (occurrence: TermOccurrence) => boolean,
): boolean {
  return findTermOccurrences(text, terms).some(
    (occurrence) => occurrence.contextStatus === 'asserted' && !(exclude?.(occurrence) ?? false),
  )
}
