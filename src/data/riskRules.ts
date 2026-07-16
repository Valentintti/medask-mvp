import type { RiskRule } from '../types/intake'

/**
 * 这些规则是 Demo 的保守触发条件，不是完整临床分诊标准。
 * 命中后只停止普通信息收集并提示人工或线下就医，不推断具体疾病。
 */
export const riskRules: RiskRule[] = [
  {
    id: 'risk.headache.sudden_severe',
    label: '突然剧烈头痛',
    allTermGroups: [
      ['头痛', '头疼', '脑袋疼', '太阳穴疼', '后脑勺疼', '额头疼'],
      ['突然', '一下子', '猛然', '几秒内'],
      ['剧烈', '非常痛', '最严重', '爆发', '痛到没法说话'],
    ],
    maxSpan: 64,
    escalationReason: '检测到突然剧烈头痛表达',
  },
  {
    id: 'risk.neurologic.sudden_speech_with_head_symptom',
    label: '头部症状伴突然语言异常',
    allTermGroups: [
      ['头痛', '头疼', '头晕', '发晕', '天旋地转', '晕乎乎'],
      ['突然', '一下子', '刚刚'],
      ['说话突然含糊', '说话含糊', '突然含糊', '说话不清', '不能说话', '无法表达', '口齿不清'],
    ],
    maxSpan: 80,
    escalationReason: '检测到头部症状伴突然语言表达异常',
  },
  {
    id: 'risk.neurologic.sudden_vision_with_head_symptom',
    label: '头部症状伴突然视力明显变化',
    allTermGroups: [
      ['头痛', '头疼', '头晕', '发晕', '天旋地转'],
      ['突然', '一下子', '刚刚'],
      ['看不见', '视力突然下降', '视力明显变化', '视物模糊', '复视'],
    ],
    maxSpan: 80,
    escalationReason: '检测到头部症状伴突然视力明显变化',
  },
  {
    id: 'risk.neurologic.sudden_unilateral_deficit',
    label: '头部症状伴突然单侧肢体异常',
    allTermGroups: [
      ['头痛', '头疼', '头晕', '发晕', '天旋地转', '晕乎乎'],
      ['突然', '一下子', '刚刚'],
      ['单侧肢体无力', '一侧手脚无力', '一边手脚无力', '左边脸和手臂都没力气', '右边脸和手臂都没力气', '左手抬不起来', '右手抬不起来', '一侧肢体麻木', '半边身体麻木'],
    ],
    maxSpan: 96,
    escalationReason: '检测到头部症状伴突然单侧肢体异常',
  },
  {
    id: 'risk.headache.after_severe_head_injury',
    label: '严重头部外伤后头痛加重',
    allTermGroups: [
      ['摔到头', '撞到头', '头部受伤', '头部外伤'],
      ['头痛', '头疼', '脑袋疼'],
      ['越来越重', '明显加重', '持续加重', '剧烈'],
    ],
    maxSpan: 96,
    escalationReason: '检测到严重头部外伤后头痛明显加重',
  },
  {
    id: 'risk.dizziness.with_chest_pain',
    label: '头晕伴明确胸痛',
    allTermGroups: [
      ['头晕', '发晕', '晕乎乎', '天旋地转', '头重脚轻'],
      ['胸痛', '胸口很痛', '胸口疼'],
    ],
    maxSpan: 72,
    escalationReason: '检测到头晕同时存在明确胸痛',
  },
  {
    id: 'risk.dizziness.with_severe_breathing',
    label: '头晕伴严重呼吸困难',
    allTermGroups: [
      ['头晕', '发晕', '晕乎乎', '天旋地转', '头重脚轻'],
      ['喘不上气', '无法正常呼吸', '严重呼吸困难', '连完整一句话都说不了'],
    ],
    maxSpan: 80,
    escalationReason: '检测到头晕同时存在严重呼吸困难',
  },
  {
    id: 'risk.chest_pain.explicit',
    label: '明确胸痛',
    terms: ['胸痛', '胸口很痛', '胸口非常痛', '胸口剧烈痛', '胸口痛', '胸口疼'],
    escalationReason: '检测到明确胸痛表达',
  },
  {
    id: 'risk.breathing.severe',
    label: '明显呼吸困难',
    terms: ['明显呼吸困难', '喘不上气', '呼吸非常费力', '呼吸很费力', '呼吸费力', '呼吸困难', '无法正常呼吸'],
    escalationReason: '检测到明显呼吸困难表达',
  },
  {
    id: 'risk.consciousness.altered',
    label: '意识异常或昏厥',
    terms: ['意识不清', '意识异常', '意识混乱', '意识很混乱', '昏厥', '晕厥', '突然晕倒', '晕倒了', '难以唤醒', '很难叫醒'],
    escalationReason: '检测到意识异常或昏厥表达',
  },
]

export const ESCALATION_SAFETY_MESSAGE =
  '已检测到需要优先人工判断的风险表达。请停止普通预问诊，尽快联系线下医疗机构或人工服务；如症状严重或正在加重，请立即寻求紧急帮助。'
