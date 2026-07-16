import type { AnswerValue, ComplaintId } from '../../types/intake'

const response = (candidates: unknown[], needsClarification = false) => ({
  schemaVersion: '1.0',
  candidates,
  unresolved: [],
  needsClarification,
})

const candidate = (
  slotId: string,
  value: AnswerValue,
  confidence: number,
  evidence: string,
  status: 'asserted' | 'negated' | 'uncertain' = 'asserted',
) => ({ slotId, value, confidence, evidence, status })

export interface SlotExtractionEvalCase {
  id: string
  userText: string
  complaints: ComplaintId[]
  existingAnswers?: Record<string, AnswerValue>
  rawResponse: unknown
  expectedAccepted: Array<{ slotId: string; value: AnswerValue }>
  invalidOutput?: boolean
  riskExpected?: boolean
}

/** 全部为人工编写的合成句，不包含真实患者数据。 */
export const slotExtractionCases: SlotExtractionEvalCase[] = [
  { id: 'onset-yesterday', userText: '昨天开始不舒服', complaints: ['fever'], rawResponse: response([candidate('onset', '昨天', .96, '昨天开始')]), expectedAccepted: [{ slotId: 'onset', value: '昨天' }] },
  { id: 'temp-current', userText: '现在38.5度', complaints: ['fever'], rawResponse: response([candidate('currentTemperature', 38.5, .98, '38.5度')]), expectedAccepted: [{ slotId: 'currentTemperature', value: 38.5 }] },
  { id: 'temp-max', userText: '最高烧到39度', complaints: ['fever'], rawResponse: response([candidate('maxTemperature', 39, .98, '39度')]), expectedAccepted: [{ slotId: 'maxTemperature', value: 39 }] },
  { id: 'cough-dry', userText: '主要是干咳', complaints: ['cough'], rawResponse: response([candidate('coughType', 'dry', .97, '干咳')]), expectedAccepted: [{ slotId: 'coughType', value: 'dry' }] },
  { id: 'cough-productive', userText: '有黄色的痰', complaints: ['cough'], rawResponse: response([candidate('coughType', 'productive', .96, '有黄色的痰'), candidate('sputumColor', '黄色', .95, '黄色')]), expectedAccepted: [{ slotId: 'coughType', value: 'productive' }, { slotId: 'sputumColor', value: '黄色' }] },
  { id: 'duration-three-days', userText: '已经咳了三天', complaints: ['cough'], rawResponse: response([candidate('duration', '三天', .95, '三天')]), expectedAccepted: [{ slotId: 'duration', value: '三天' }] },
  { id: 'fever-repeat', userText: '体温退了又反复', complaints: ['fever'], rawResponse: response([candidate('feverPattern', '反复', .94, '反复')]), expectedAccepted: [{ slotId: 'feverPattern', value: '反复' }] },
  { id: 'chills', userText: '同时有寒战', complaints: ['fever'], rawResponse: response([candidate('chills', true, .94, '寒战')]), expectedAccepted: [{ slotId: 'chills', value: true }] },
  { id: 'fever-associated', userText: '咳嗽时也发烧', complaints: ['cough'], rawResponse: response([candidate('feverAssociated', true, .94, '发烧')]), expectedAccepted: [{ slotId: 'feverAssociated', value: true }] },
  { id: 'night-worse', userText: '晚上咳得更明显', complaints: ['cough'], rawResponse: response([candidate('nocturnalWorsening', true, .93, '晚上咳得更明显')]), expectedAccepted: [{ slotId: 'nocturnalWorsening', value: true }] },
  { id: 'measure-history', userText: '已经做过退热处理', complaints: ['fever'], rawResponse: response([candidate('medicationHistory', '做过退热处理', .92, '做过退热处理')]), expectedAccepted: [{ slotId: 'medicationHistory', value: '做过退热处理' }] },
  { id: 'multi-slot', userText: '昨天开始干咳', complaints: ['cough'], rawResponse: response([candidate('onset', '昨天', .96, '昨天开始'), candidate('coughType', 'dry', .97, '干咳')]), expectedAccepted: [{ slotId: 'onset', value: '昨天' }, { slotId: 'coughType', value: 'dry' }] },
  { id: 'negated-chest', userText: '没有胸痛', complaints: ['fever'], rawResponse: response([candidate('chestPain', false, .99, '没有胸痛', 'negated')]), expectedAccepted: [] },
  { id: 'negated-breathing', userText: '没有呼吸困难', complaints: ['cough'], rawResponse: response([candidate('breathingDifficulty', false, .99, '没有呼吸困难', 'negated')]), expectedAccepted: [] },
  { id: 'uncertain-fever', userText: '可能有点发烧吧', complaints: ['cough'], rawResponse: response([candidate('feverAssociated', true, .6, '可能有点发烧', 'uncertain')], true), expectedAccepted: [] },
  { id: 'low-confidence', userText: '好像昨天开始', complaints: ['fever'], rawResponse: response([candidate('onset', '昨天', .72, '昨天开始')], true), expectedAccepted: [] },
  { id: 'out-of-range', userText: '机器写成999度', complaints: ['fever'], rawResponse: response([candidate('currentTemperature', 999, .99, '999度')]), expectedAccepted: [], invalidOutput: true },
  { id: 'unknown-slot', userText: '模型提到神秘字段', complaints: ['fever'], rawResponse: response([candidate('mysterySlot', '值', .99, '神秘字段')]), expectedAccepted: [], invalidOutput: true },
  { id: 'hallucinated-evidence', userText: '今天不舒服', complaints: ['fever'], rawResponse: response([candidate('onset', '昨天', .99, '昨天开始')]), expectedAccepted: [], invalidOutput: true },
  { id: 'existing-conflict', userText: '现在已经37度', complaints: ['fever'], existingAnswers: { currentTemperature: 38.5 }, rawResponse: response([candidate('currentTemperature', 37, .99, '37度')]), expectedAccepted: [] },
  { id: 'risk-chest', userText: '现在突然胸痛', complaints: ['fever'], rawResponse: response([candidate('onset', '现在', .99, '现在')]), expectedAccepted: [], riskExpected: true },
  { id: 'risk-breathing', userText: '现在喘不上气', complaints: ['cough'], rawResponse: response([candidate('onset', '现在', .99, '现在')]), expectedAccepted: [], riskExpected: true },
  { id: 'risk-faint', userText: '刚才突然晕倒', complaints: ['fever'], rawResponse: response([candidate('onset', '刚才', .99, '刚才')]), expectedAccepted: [], riskExpected: true },
  { id: 'resolved-uncertain', userText: '之前发热现在好了', complaints: ['fever'], rawResponse: response([candidate('feverPattern', '不确定', .62, '之前发热现在好了', 'uncertain')], true), expectedAccepted: [] },
  { id: 'historical-onset', userText: '去年有过一次', complaints: ['fever'], rawResponse: response([candidate('onset', '去年', .91, '去年')]), expectedAccepted: [{ slotId: 'onset', value: '去年' }] },
  { id: 'recurrence-multi', userText: '今天又发热而且反复', complaints: ['fever'], rawResponse: response([candidate('onset', '今天', .95, '今天'), candidate('feverPattern', '反复', .95, '反复')]), expectedAccepted: [{ slotId: 'onset', value: '今天' }, { slotId: 'feverPattern', value: '反复' }] },
  { id: 'negation-conflict', userText: '没有发热', complaints: ['cough'], rawResponse: response([candidate('feverAssociated', true, .98, '没有发热')]), expectedAccepted: [], invalidOutput: true },
  { id: 'extra-field', userText: '返回额外字段', complaints: ['fever'], rawResponse: { schemaVersion: '1.0', candidates: [], unresolved: [], needsClarification: false, diagnosis: '禁止' }, expectedAccepted: [], invalidOutput: true },
  { id: 'invalid-json', userText: '返回非法JSON', complaints: ['fever'], rawResponse: '{not-json', expectedAccepted: [], invalidOutput: true },
  { id: 'invalid-option', userText: '咳嗽类型未知编码', complaints: ['cough'], rawResponse: response([candidate('coughType', 'wet-code', .99, '未知编码')]), expectedAccepted: [], invalidOutput: true },
]
