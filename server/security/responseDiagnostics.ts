import { ProviderRequestError } from '../providers/openAiCompatibleProvider'

export const schemaFailureCategories = [
  'empty_content', 'invalid_json', 'missing_field', 'extra_field', 'invalid_enum',
  'invalid_slot_id', 'invalid_value_type', 'schema_version_mismatch', 'truncated_output',
  'tool_call_missing', 'other',
] as const
export type SchemaFailureCategory = typeof schemaFailureCategories[number]

export interface SchemaFailureDiagnostic {
  category: SchemaFailureCategory
  stage: 'provider' | 'top_level' | 'candidate' | 'unresolved_slots' | 'unknown'
  shape: string
}

const TOP_LEVEL_KEYS = ['schemaVersion', 'candidates', 'unresolvedSlotIds', 'needsClarification']
const CANDIDATE_KEYS = ['slotId', 'value', 'confidence', 'evidence', 'status']
const STATUSES = new Set(['asserted', 'negated', 'uncertain', 'historical', 'resolved', 'hypothetical'])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function keyDifference(actual: string[], expected: string[]): { missing: string[]; extra: string[] } {
  return {
    missing: expected.filter((key) => !actual.includes(key)),
    extra: actual.filter((key) => !expected.includes(key)),
  }
}

export function classifyExtractionFailure(
  rawJson: string | undefined,
  error: unknown,
  allowedSlotIds: readonly string[],
): SchemaFailureDiagnostic {
  if (error instanceof ProviderRequestError) {
    if (error.code === 'empty_content') return { category: 'empty_content', stage: 'provider', shape: 'content_empty' }
    if (error.code === 'tool_call_missing') return { category: 'tool_call_missing', stage: 'provider', shape: 'required_tool_absent' }
    if (error.code === 'truncated_output') return { category: 'truncated_output', stage: 'provider', shape: 'finish_reason_length' }
  }
  if (rawJson === undefined) return { category: 'other', stage: 'provider', shape: 'provider_failure_without_payload' }
  const text = rawJson.trim()
  if (!text) return { category: 'empty_content', stage: 'provider', shape: 'content_empty' }
  if (text.startsWith('{') && !text.endsWith('}')) return { category: 'truncated_output', stage: 'top_level', shape: 'object_not_closed' }

  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return { category: 'invalid_json', stage: 'top_level', shape: 'json_parse_failed' } }
  if (!record(parsed)) return { category: 'invalid_json', stage: 'top_level', shape: Array.isArray(parsed) ? 'array_root' : 'non_object_root' }

  const topKeys = keyDifference(Object.keys(parsed), TOP_LEVEL_KEYS)
  if (topKeys.missing.length) return { category: 'missing_field', stage: 'top_level', shape: `missing_${topKeys.missing.length}` }
  if (topKeys.extra.length) return { category: 'extra_field', stage: 'top_level', shape: `extra_${topKeys.extra.length}` }
  if (parsed.schemaVersion !== '1.1') return { category: 'schema_version_mismatch', stage: 'top_level', shape: 'version_not_1_1' }
  if (!Array.isArray(parsed.candidates) || !Array.isArray(parsed.unresolvedSlotIds) || typeof parsed.needsClarification !== 'boolean') {
    return { category: 'invalid_value_type', stage: 'top_level', shape: 'container_type_invalid' }
  }
  if (parsed.unresolvedSlotIds.some((slotId) => typeof slotId !== 'string' || !allowedSlotIds.includes(slotId))) {
    return { category: 'invalid_slot_id', stage: 'unresolved_slots', shape: 'unresolved_outside_allowlist' }
  }
  for (const candidate of parsed.candidates) {
    if (!record(candidate)) return { category: 'invalid_value_type', stage: 'candidate', shape: 'candidate_not_object' }
    const candidateKeys = keyDifference(Object.keys(candidate), CANDIDATE_KEYS)
    if (candidateKeys.missing.length) return { category: 'missing_field', stage: 'candidate', shape: `missing_${candidateKeys.missing.length}` }
    if (candidateKeys.extra.length) return { category: 'extra_field', stage: 'candidate', shape: `extra_${candidateKeys.extra.length}` }
    if (!STATUSES.has(String(candidate.status))) return { category: 'invalid_enum', stage: 'candidate', shape: 'status_outside_enum' }
    if (typeof candidate.slotId !== 'string' || !allowedSlotIds.includes(candidate.slotId)) {
      return { category: 'invalid_slot_id', stage: 'candidate', shape: 'candidate_outside_allowlist' }
    }
    if (!['string', 'number', 'boolean'].includes(typeof candidate.value)) {
      return { category: 'invalid_value_type', stage: 'candidate', shape: 'candidate_value_type_invalid' }
    }
  }
  return { category: 'other', stage: 'unknown', shape: 'downstream_semantic_rejection' }
}
