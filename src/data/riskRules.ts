import type { RiskRule } from '../types/intake'

/**
 * 这些规则是 Demo 的保守触发条件，不是完整临床分诊标准。
 * 命中后只停止普通信息收集并提示人工或线下就医，不推断具体疾病。
 */
export const riskRules: RiskRule[] = [
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
    terms: ['意识不清', '昏厥', '晕厥', '突然晕倒'],
    escalationReason: '检测到意识异常或昏厥表达',
  },
]

export const ESCALATION_SAFETY_MESSAGE =
  '已检测到需要优先人工判断的风险表达。请停止普通预问诊，尽快联系线下医疗机构或人工服务；如症状严重或正在加重，请立即寻求紧急帮助。'
