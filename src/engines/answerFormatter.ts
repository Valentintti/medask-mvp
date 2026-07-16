import type { AnswerValue, SlotDefinition } from '../types/intake'

const USER_HISTORY_PATTERN = /(?:医生|医院).{0,12}(?:诊断|确诊|开药|开过)|(?:诊断为|确诊为|开过药|给我开过药)/u

export function formatUserNarrative(value: string): string {
  return USER_HISTORY_PATTERN.test(value) ? `用户自述：${value}` : value
}

export function formatAnswerValue(slot: SlotDefinition, value: AnswerValue): string {
  if (typeof value === 'boolean') return value ? '是' : '否'

  if (typeof value === 'number') {
    return `${value}${slot.unit ?? ''}`
  }

  if (Array.isArray(value)) return value.join('、')

  if (slot.inputType === 'singleSelect') {
    return slot.options?.find((option) => option.value === value)?.label ?? '不确定'
  }

  return formatUserNarrative(value)
}
