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
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_LLM_TIMEOUT_MS,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let parentAbortHandler: (() => void) | undefined

  const abortError = (message: 'provider_timeout' | 'provider_aborted') => {
    const error = new Error(message)
    error.name = 'AbortError'
    return error
  }

  if (parentSignal?.aborted) throw abortError('provider_aborted')

  try {
    if (parentSignal) {
      parentAbortHandler = () => controller.abort(abortError('provider_aborted'))
      parentSignal.addEventListener('abort', parentAbortHandler, { once: true })
    }

    const providerOperation = operation(controller.signal)
    return await Promise.race([
      providerOperation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = abortError('provider_timeout')
          controller.abort(error)
          reject(error)
        }, timeoutMs)
      }),
      new Promise<T>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          const reason = controller.signal.reason
          reject(reason instanceof Error ? reason : abortError('provider_aborted'))
        }, { once: true })
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (parentSignal && parentAbortHandler) {
      parentSignal.removeEventListener('abort', parentAbortHandler)
    }
  }
}
