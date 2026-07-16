import type {
  CandidateRejectionReason,
  QuestionRewriteResponse,
  SlotCandidate,
  SlotExtractionResponse,
} from './types'

export interface SchemaResult<T> {
  valid: boolean
  value: T | null
  reason: CandidateRejectionReason | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(record: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(record).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parseJson(raw: unknown): SchemaResult<unknown> {
  if (typeof raw !== 'string') return { valid: true, value: raw, reason: null }
  try {
    return { valid: true, value: JSON.parse(raw), reason: null }
  } catch {
    return { valid: false, value: null, reason: 'invalid_json' }
  }
}

function parseCandidate(raw: unknown): SchemaResult<SlotCandidate> {
  if (!isRecord(raw)) return { valid: false, value: null, reason: 'schema_invalid' }
  if (!hasExactKeys(raw, ['slotId', 'value', 'confidence', 'evidence', 'status'])) {
    return { valid: false, value: null, reason: 'extra_field' }
  }
  if (
    typeof raw.slotId !== 'string' ||
    !raw.slotId ||
    !['string', 'number', 'boolean'].includes(typeof raw.value) ||
    typeof raw.confidence !== 'number' ||
    !Number.isFinite(raw.confidence) ||
    raw.confidence < 0 ||
    raw.confidence > 1 ||
    typeof raw.evidence !== 'string' ||
    !raw.evidence ||
    raw.evidence.length > 80 ||
    !['asserted', 'negated', 'uncertain'].includes(String(raw.status))
  ) {
    return { valid: false, value: null, reason: 'schema_invalid' }
  }
  return { valid: true, value: raw as unknown as SlotCandidate, reason: null }
}

export function parseSlotExtractionResponse(raw: unknown): SchemaResult<SlotExtractionResponse> {
  const parsed = parseJson(raw)
  if (!parsed.valid || !isRecord(parsed.value)) {
    return { valid: false, value: null, reason: parsed.reason ?? 'schema_invalid' }
  }
  if (!hasExactKeys(parsed.value, ['schemaVersion', 'candidates', 'unresolved', 'needsClarification'])) {
    return { valid: false, value: null, reason: 'extra_field' }
  }
  if (parsed.value.schemaVersion !== '1.0') {
    return { valid: false, value: null, reason: 'schema_version_mismatch' }
  }
  if (
    !Array.isArray(parsed.value.candidates) ||
    !Array.isArray(parsed.value.unresolved) ||
    !parsed.value.unresolved.every((item) => typeof item === 'string') ||
    typeof parsed.value.needsClarification !== 'boolean'
  ) {
    return { valid: false, value: null, reason: 'schema_invalid' }
  }

  const candidates: SlotCandidate[] = []
  for (const candidate of parsed.value.candidates) {
    const candidateResult = parseCandidate(candidate)
    if (!candidateResult.valid || !candidateResult.value) {
      return { valid: false, value: null, reason: candidateResult.reason }
    }
    candidates.push(candidateResult.value)
  }

  return {
    valid: true,
    value: {
      schemaVersion: '1.0',
      candidates,
      unresolved: parsed.value.unresolved as string[],
      needsClarification: parsed.value.needsClarification,
    },
    reason: null,
  }
}

export function parseQuestionRewriteResponse(raw: unknown): SchemaResult<QuestionRewriteResponse> {
  const parsed = parseJson(raw)
  if (!parsed.valid || !isRecord(parsed.value)) {
    return { valid: false, value: null, reason: parsed.reason ?? 'rewrite_invalid' }
  }
  if (!hasExactKeys(parsed.value, ['rewrittenQuestion', 'confidence'])) {
    return { valid: false, value: null, reason: 'extra_field' }
  }
  if (
    typeof parsed.value.rewrittenQuestion !== 'string' ||
    !parsed.value.rewrittenQuestion.trim() ||
    parsed.value.rewrittenQuestion.length > 120 ||
    typeof parsed.value.confidence !== 'number' ||
    !Number.isFinite(parsed.value.confidence) ||
    parsed.value.confidence < 0 ||
    parsed.value.confidence > 1
  ) {
    return { valid: false, value: null, reason: 'rewrite_invalid' }
  }
  return {
    valid: true,
    value: {
      rewrittenQuestion: parsed.value.rewrittenQuestion,
      confidence: parsed.value.confidence,
    },
    reason: null,
  }
}
