export interface TermOccurrence {
  term: string
  index: number
  negated: boolean
}

const CLAUSE_BOUNDARY = /(?:但是|然而|不过|可是|但|却|[，。！？；,.!?;])/u
const NEGATION_SCOPE = /(?:并?没有|无|否认|未出现|不伴有?|不存在|未见|并无|不)\s*[^，。！？；,.!?;]{0,8}$/u

function localPrefix(text: string, index: number, windowSize = 16): string {
  const window = text.slice(Math.max(0, index - windowSize), index)
  const clauses = window.split(CLAUSE_BOUNDARY)
  return clauses.at(-1) ?? ''
}

export function findTermOccurrences(text: string, terms: string[]): TermOccurrence[] {
  const occurrences: TermOccurrence[] = []

  for (const term of [...new Set(terms)].sort((left, right) => right.length - left.length)) {
    let fromIndex = 0
    while (fromIndex < text.length) {
      const index = text.indexOf(term, fromIndex)
      if (index < 0) break
      occurrences.push({
        term,
        index,
        negated: NEGATION_SCOPE.test(localPrefix(text, index)),
      })
      fromIndex = index + term.length
    }
  }

  return occurrences.sort((left, right) => left.index - right.index || right.term.length - left.term.length)
}

export function hasAffirmedTerm(
  text: string,
  terms: string[],
  exclude?: (occurrence: TermOccurrence) => boolean,
): boolean {
  return findTermOccurrences(text, terms).some(
    (occurrence) => !occurrence.negated && !(exclude?.(occurrence) ?? false),
  )
}
