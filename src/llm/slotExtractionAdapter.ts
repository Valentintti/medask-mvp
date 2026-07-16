import { createLlmTrace } from './llmTrace'
import { DEFAULT_LLM_TIMEOUT_MS, withProviderTimeout } from './provider'
import { parseSlotExtractionResponse } from './schema'
import { validateExtractionOutput } from './outputValidator'
import type {
  CandidateRejection,
  CandidateRejectionReason,
  ExtractionAdapterInput,
  ExtractionAdapterResult,
  LlmProvider,
  SlotExtractionRequest,
} from './types'
import { LLM_SCHEMA_VERSION } from './types'

export interface SlotExtractionAdapterOptions {
  timeoutMs?: number
  confidenceThreshold?: number
}

export class SlotExtractionAdapter {
  constructor(
    private readonly provider: LlmProvider,
    private readonly options: SlotExtractionAdapterOptions = {},
  ) {}

  async extract(input: ExtractionAdapterInput, signal?: AbortSignal): Promise<ExtractionAdapterResult> {
    const startedAt = Date.now()
    const request: SlotExtractionRequest = {
      supportedComplaints: [...input.supportedComplaints],
      allowedSlotIds: input.allowedSlots.map((slot) => slot.id),
      currentQuestionSlotId: input.currentQuestionSlotId,
      userText: input.userText,
      existingSlotIds: Object.keys(input.existingAnswers),
      locale: 'zh-CN',
      schemaVersion: LLM_SCHEMA_VERSION,
    }

    let raw: unknown
    try {
      raw = await withProviderTimeout(
        (providerSignal) => this.provider.extractSlots(request, providerSignal),
        this.options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
        signal,
      )
    } catch (error) {
      const reason: CandidateRejectionReason =
        error instanceof Error && error.message === 'provider_timeout'
          ? 'provider_timeout'
          : error instanceof Error && error.message === 'provider_aborted'
            ? 'provider_aborted'
            : 'provider_error'
      return this.fallbackResult(startedAt, reason)
    }

    const schema = parseSlotExtractionResponse(raw, request.allowedSlotIds)
    if (!schema.valid || !schema.value) {
      return this.fallbackResult(startedAt, schema.reason ?? 'schema_invalid')
    }

    const validated = validateExtractionOutput({
      response: schema.value,
      allowedSlots: input.allowedSlots,
      userText: input.userText,
      existingAnswers: input.existingAnswers,
      threshold: this.options.confidenceThreshold,
    })
    const actionableRejections = validated.rejectedCandidates.filter(
      (item) => item.reason !== 'already_answered_same_value',
    )
    const needsClarification =
      schema.value.needsClarification ||
      validated.conflicts.length > 0 ||
      schema.value.unresolvedSlotIds.length > 0 ||
      (validated.acceptedCandidates.length === 0 && actionableRejections.length > 0)
    const outcome = validated.acceptedCandidates.length
      ? 'accepted'
      : needsClarification
        ? 'clarification'
        : 'rejected'

    return {
      ...validated,
      needsClarification,
      fallbackToRules: false,
      trace: createLlmTrace({
        providerName: this.provider.name,
        operation: 'slot_extraction',
        schemaVersion: LLM_SCHEMA_VERSION,
        startedAt,
        outcome,
        acceptedCandidateCount: validated.acceptedCandidates.length,
        rejectedCandidateCount: validated.rejectedCandidates.length,
        rejectionReasons: validated.rejectedCandidates.map((item) => item.reason),
      }),
    }
  }

  private fallbackResult(
    startedAt: number,
    reason: CandidateRejectionReason,
  ): ExtractionAdapterResult {
    const rejectedCandidates: CandidateRejection[] = [{ slotId: null, reason }]
    return {
      acceptedCandidates: [],
      rejectedCandidates,
      conflicts: [],
      needsClarification: false,
      fallbackToRules: true,
      trace: createLlmTrace({
        providerName: this.provider.name,
        operation: 'slot_extraction',
        schemaVersion: LLM_SCHEMA_VERSION,
        startedAt,
        outcome: 'fallback',
        rejectedCandidateCount: 1,
        rejectionReasons: [reason],
      }),
    }
  }
}
