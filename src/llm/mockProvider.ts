import type {
  LlmProvider,
  QuestionRewriteRawResponse,
  QuestionRewriteRequest,
  SlotExtractionRawResponse,
  SlotExtractionRequest,
} from './types'
import { LLM_SCHEMA_VERSION } from './types'

const response = (candidates: unknown[], needsClarification = false) => ({
  schemaVersion: LLM_SCHEMA_VERSION,
  candidates,
  unresolvedSlotIds: [],
  needsClarification,
})

const BUILT_IN_RESPONSES: Record<string, unknown> = {
  '我昨天开始发烧': response([
    { slotId: 'onset', value: '昨天', confidence: 0.94, evidence: '昨天开始', status: 'asserted' },
  ]),
  '现在38.5度': response([
    { slotId: 'currentTemperature', value: 38.5, confidence: 0.98, evidence: '38.5度', status: 'asserted' },
  ]),
  '最高烧到39度': response([
    { slotId: 'maxTemperature', value: 39, confidence: 0.98, evidence: '39度', status: 'asserted' },
  ]),
  '主要是干咳': response([
    { slotId: 'coughType', value: 'dry', confidence: 0.97, evidence: '干咳', status: 'asserted' },
  ]),
  '有黄色的痰': response([
    { slotId: 'coughType', value: 'productive', confidence: 0.96, evidence: '有黄色的痰', status: 'asserted' },
    { slotId: 'sputumColor', value: '黄色', confidence: 0.95, evidence: '黄色', status: 'asserted' },
  ]),
  '没有胸痛': response([
    { slotId: 'chestPain', value: false, confidence: 0.99, evidence: '没有胸痛', status: 'negated' },
  ]),
  '喘不上气': response([
    { slotId: 'breathingDifficulty', value: true, confidence: 0.99, evidence: '喘不上气', status: 'asserted' },
  ]),
  '可能有点发烧吧': response([
    { slotId: 'feverAssociated', value: true, confidence: 0.6, evidence: '可能有点发烧', status: 'uncertain' },
  ], true),
  '模型返回999度': response([
    { slotId: 'currentTemperature', value: 999, confidence: 0.99, evidence: '999度', status: 'asserted' },
  ]),
  '模型返回不存在槽位': response([
    { slotId: 'unknownSlot', value: '值', confidence: 0.99, evidence: '不存在槽位', status: 'asserted' },
  ]),
  '模型返回幻觉证据': response([
    { slotId: 'onset', value: '昨天', confidence: 0.99, evidence: '昨天开始', status: 'asserted' },
  ]),
  '昨天开始头痛': response([
    { slotId: 'onset', value: '昨天', confidence: 0.98, evidence: '昨天开始', status: 'asserted' },
  ]),
  '突然开始剧烈头痛': response([
    { slotId: 'headacheOnsetSpeed', value: 'sudden', confidence: 0.99, evidence: '突然开始', status: 'asserted' },
  ]),
  '太阳穴一阵阵疼': response([
    { slotId: 'headacheLocation', value: 'temple', confidence: 0.98, evidence: '太阳穴', status: 'asserted' },
    { slotId: 'headachePattern', value: 'intermittent', confidence: 0.98, evidence: '一阵阵', status: 'asserted' },
  ]),
  '没有头痛': response([
    { slotId: 'headacheSensation', value: '头痛', confidence: 0.99, evidence: '没有头痛', status: 'negated' },
  ]),
  '头痛已经好了': response([
    { slotId: 'headachePattern', value: 'uncertain', confidence: 0.99, evidence: '头痛已经好了', status: 'resolved' },
  ]),
  '今天开始天旋地转': response([
    { slotId: 'onset', value: '今天', confidence: 0.98, evidence: '今天开始', status: 'asserted' },
    { slotId: 'dizzinessExperience', value: 'spinning', confidence: 0.99, evidence: '天旋地转', status: 'asserted' },
  ]),
  '站起来会发晕': response([
    { slotId: 'dizzinessTrigger', value: 'standing_up', confidence: 0.98, evidence: '站起来', status: 'asserted' },
  ]),
  '走路有点不稳': response([
    { slotId: 'balanceImpact', value: 'unsteady', confidence: 0.96, evidence: '走路有点不稳', status: 'asserted' },
  ]),
  '没有头晕': response([
    { slotId: 'dizzinessExperience', value: 'uncertain', confidence: 0.99, evidence: '没有头晕', status: 'negated' },
  ]),
  '头晕已经缓解': response([
    { slotId: 'dizzinessPattern', value: 'uncertain', confidence: 0.99, evidence: '头晕已经缓解', status: 'resolved' },
  ]),
  '__INVALID_JSON__': '{invalid json',
  '__EXTRA_FIELD__': {
    schemaVersion: LLM_SCHEMA_VERSION, candidates: [], unresolvedSlotIds: [], needsClarification: false, diagnosis: '禁止',
  },
}

const REWRITES: Record<string, string> = {
  onset: '这些不适是从什么时候开始的？',
  currentTemperature: '现在测到的体温是多少？没测过也可以跳过。',
  maxTemperature: '这次最高体温是多少？没测过也可以跳过。',
  feverPattern: '发热是持续的，还是会反复？',
  coughType: '咳嗽主要是干咳，还是有痰？',
  duration: '咳嗽持续多久了？',
  sputumColor: '痰大概是什么颜色？',
  feverAssociated: '咳嗽时有没有同时发热？',
  breathingDifficulty: '现在有没有明显呼吸困难？',
  chestPain: '现在有没有明确胸痛？',
  headacheOnsetSpeed: '头痛是突然出现、逐渐出现，还是暂时不确定？',
  headacheFunctionalImpact: '头痛对日常活动有多大影响？',
  headacheLocation: '头痛主要位于头部哪里？',
  headachePattern: '头痛是持续、间歇、反复，还是不确定？',
  headacheSensation: '请用自己的话描述头痛的感觉。',
  headacheEpisodeDuration: '每次头痛大约持续多久？',
  dizzinessExperience: '头晕主要是什么样的感觉？',
  dizzinessFunctionalImpact: '头晕对日常活动有多大影响？',
  dizzinessPattern: '头晕是持续、间歇、反复，还是不确定？',
  dizzinessTrigger: '头晕通常在什么情况下出现？',
  balanceImpact: '头晕时行走和平衡受到什么影响？',
  dizzinessEpisodeDuration: '每次头晕大约持续多久？',
  medicationHistory: '针对本次不适，你已经采取过哪些处理？',
}

export interface MockProviderOptions {
  responses?: Record<string, unknown>
  rewriteResponses?: Record<string, unknown>
  delayMs?: number
  throwInputs?: string[]
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('provider_aborted'))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error('provider_aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock-deterministic-v1'
  extractionCallCount = 0
  rewriteCallCount = 0
  abortedExtractionCount = 0
  abortedRewriteCount = 0
  lastExtractionRequest: SlotExtractionRequest | null = null

  constructor(private readonly options: MockProviderOptions = {}) {}

  async extractSlots(input: SlotExtractionRequest, signal?: AbortSignal): Promise<SlotExtractionRawResponse> {
    this.extractionCallCount += 1
    this.lastExtractionRequest = structuredClone(input)
    try {
      if (this.options.delayMs) await waitForDelay(this.options.delayMs, signal)
    } catch (error) {
      if (signal?.aborted) this.abortedExtractionCount += 1
      throw error
    }
    if (signal?.aborted) throw signal.reason ?? new Error('provider_aborted')
    if (this.options.throwInputs?.includes(input.userText)) throw new Error('mock_provider_failure')
    return this.options.responses?.[input.userText] ?? BUILT_IN_RESPONSES[input.userText] ?? response([], true)
  }

  async rewriteQuestion(input: QuestionRewriteRequest, signal?: AbortSignal): Promise<QuestionRewriteRawResponse> {
    this.rewriteCallCount += 1
    try {
      if (this.options.delayMs) await waitForDelay(this.options.delayMs, signal)
    } catch (error) {
      if (signal?.aborted) this.abortedRewriteCount += 1
      throw error
    }
    if (signal?.aborted) throw signal.reason ?? new Error('provider_aborted')
    const override = this.options.rewriteResponses?.[input.slotId]
    if (override !== undefined) return override
    return {
      schemaVersion: LLM_SCHEMA_VERSION,
      rewrittenQuestion: REWRITES[input.slotId] ?? input.canonicalQuestion,
      confidence: 0.96,
    }
  }
}
