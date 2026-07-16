import type {
  LlmProvider,
  QuestionRewriteRawResponse,
  QuestionRewriteRequest,
  SlotExtractionRawResponse,
  SlotExtractionRequest,
} from './types'

const response = (candidates: unknown[], needsClarification = false) => ({
  schemaVersion: '1.0',
  candidates,
  unresolved: [],
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
  '__INVALID_JSON__': '{invalid json',
  '__EXTRA_FIELD__': {
    schemaVersion: '1.0', candidates: [], unresolved: [], needsClarification: false, diagnosis: '禁止',
  },
}

const REWRITES: Record<string, string> = {
  onset: '这些不适是从什么时候开始的？',
  currentTemperature: '现在测到的体温是多少？',
  maxTemperature: '这次最高体温是多少？',
  feverPattern: '发热是持续的，还是会反复？',
  coughType: '咳嗽主要是干咳，还是有痰？',
  duration: '咳嗽持续多久了？',
  sputumColor: '痰大概是什么颜色？',
  feverAssociated: '咳嗽时有没有同时发热？',
  breathingDifficulty: '现在有没有明显呼吸困难？',
  chestPain: '现在有没有明确胸痛？',
}

export interface MockProviderOptions {
  responses?: Record<string, unknown>
  rewriteResponses?: Record<string, unknown>
  delayMs?: number
  throwInputs?: string[]
}

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock-deterministic-v1'
  extractionCallCount = 0
  rewriteCallCount = 0
  lastExtractionRequest: SlotExtractionRequest | null = null

  constructor(private readonly options: MockProviderOptions = {}) {}

  async extractSlots(input: SlotExtractionRequest): Promise<SlotExtractionRawResponse> {
    this.extractionCallCount += 1
    this.lastExtractionRequest = structuredClone(input)
    if (this.options.delayMs) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs))
    if (this.options.throwInputs?.includes(input.userText)) throw new Error('mock_provider_failure')
    return this.options.responses?.[input.userText] ?? BUILT_IN_RESPONSES[input.userText] ?? response([], true)
  }

  async rewriteQuestion(input: QuestionRewriteRequest): Promise<QuestionRewriteRawResponse> {
    this.rewriteCallCount += 1
    if (this.options.delayMs) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs))
    const override = this.options.rewriteResponses?.[input.slotId]
    if (override !== undefined) return override
    return {
      rewrittenQuestion: REWRITES[input.slotId] ?? input.canonicalQuestion,
      confidence: 0.96,
    }
  }
}
