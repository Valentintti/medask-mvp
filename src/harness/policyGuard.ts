export const POLICY_DISCLAIMER = '本摘要仅用于预问诊信息整理，不是诊断结论。'

const prohibitedOutputRules = [
  { id: 'policy.diagnosis', pattern: /(?:确诊为|诊断为|你患有|这是.+病)/u },
  { id: 'policy.probability', pattern: /(?:患病概率|疾病概率|\d+%可能是)/u },
  { id: 'policy.prescription', pattern: /(?:处方|给你开药)/u },
  { id: 'policy.drug_recommendation', pattern: /建议(?:服用|使用|吃).{0,20}(?:药|片|胶囊)/u },
  { id: 'policy.dosage', pattern: /(?:每次|每日|一天).{0,12}(?:毫克|mg|片|粒)/iu },
  { id: 'policy.treatment', pattern: /治疗方案(?:是|为)|建议采用.+治疗/u },
  { id: 'policy.replace_doctor', pattern: /(?:可以|能够)替代医生/u },
]

export function findPolicyViolations(text: string): string[] {
  return prohibitedOutputRules
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.id)
}

export function assertPolicySafe(text: string): void {
  const violations = findPolicyViolations(text)
  if (violations.length > 0) {
    throw new Error(`输出越过产品边界：${violations.join(', ')}`)
  }
}

/** 仅审核系统生成的模板和叙述。用户原文必须在调用前与系统文本分离。 */
export function assertSystemNarrativesSafe(narratives: string[]): void {
  assertPolicySafe(narratives.join('\n'))
}
