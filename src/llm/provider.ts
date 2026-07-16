import type {
  LlmProvider,
  QuestionRewriteRawResponse,
  QuestionRewriteRequest,
  SlotExtractionRawResponse,
  SlotExtractionRequest,
} from './types'

export type {
  LlmProvider,
  QuestionRewriteRawResponse,
  QuestionRewriteRequest,
  SlotExtractionRawResponse,
  SlotExtractionRequest,
}

export const DEFAULT_LLM_TIMEOUT_MS = 1500

export async function withProviderTimeout<T>(
  operation: Promise<T>,
  timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('provider_timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
