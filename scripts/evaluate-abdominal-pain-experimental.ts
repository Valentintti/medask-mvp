import { evaluateAbdominalPainExperimental } from '../src/evals/abdominalPainExperimental'

// 仅打印聚合的合成工程指标，不包含患者文本或人工复核内容。
console.log(JSON.stringify(evaluateAbdominalPainExperimental(), null, 2))
