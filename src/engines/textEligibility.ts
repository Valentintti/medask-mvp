/**
 * 保守识别明显的表单占位、医生回答或批量拼接文本。
 * 这里只用于拒绝把无效文本当作患者当前症状，不尝试清洗或推断原始内容。
 */
const TEMPLATE_MARKERS = /(?:患者(?:姓名|性别|年龄)\s*[:：]|问题描述\s*[:：]?\s*$|问题描述问题描述|请输入.{0,12}(?:内容|症状)|(?:复制|填写).{0,12}模板)/u
const NON_PATIENT_SECTIONS = /(?:医生回答|医生回复|最佳答案|治疗建议|用药建议|相关阅读|免责声明|本文仅供参考|SEO)/iu
const LABELED_SECTION = /(?:问题描述|患者信息|医生回答|治疗建议|相关疾病)\s*[:：]/gu

export function isInvalidOrConcatenatedMedicalText(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  if (TEMPLATE_MARKERS.test(normalized) || NON_PATIENT_SECTIONS.test(normalized)) return true
  return (normalized.match(LABELED_SECTION) ?? []).length >= 2
}
