export const SHARED_LLM_SCHEMA_VERSION = '1.1' as const

export const candidateStatuses = [
  'asserted',
  'negated',
  'uncertain',
  'historical',
  'resolved',
  'hypothetical',
] as const

export const slotExtractionJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'candidates', 'unresolvedSlotIds', 'needsClarification'],
  properties: {
    schemaVersion: { type: 'string', const: SHARED_LLM_SCHEMA_VERSION },
    candidates: { type: 'array', maxItems: 16, items: {
      type: 'object', additionalProperties: false,
      required: ['slotId', 'value', 'confidence', 'evidence', 'status'],
      properties: {
        slotId: { type: 'string', minLength: 1, maxLength: 64 },
        value: { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        evidence: { type: 'string', minLength: 1, maxLength: 80 },
        status: { type: 'string', enum: candidateStatuses },
      },
    } },
    unresolvedSlotIds: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 64 } },
    needsClarification: { type: 'boolean' },
  },
} as const

export const questionRewriteJsonSchema = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'rewrittenQuestion', 'confidence'],
  properties: {
    schemaVersion: { type: 'string', const: SHARED_LLM_SCHEMA_VERSION },
    rewrittenQuestion: { type: 'string', minLength: 1, maxLength: 120 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const
