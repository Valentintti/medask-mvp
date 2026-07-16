# MedAsk 评测摘要

> 所有指标都用于语言标签、结构化输出和工程安全评测，不是临床准确率、诊断准确率或医疗有效性结论。

## 1. 透明规则版

| 指标 | gold_v1 开发集（120） | gold_v2 未见验证（60） |
|---|---:|---:|
| strict candidate accuracy | 86.7% | 88.3% |
| current symptom rule accuracy | 98.2% | 100.0% |
| preliminary intent accuracy | 67.5% | 53.3% |
| symptom intake precision | 78.2% | 46.3% |

主诉和当前性在未见集上保持稳定；意图路由下降 14.2 和 31.8 个百分点，说明已确诊随访、用药、知识咨询与症状预问诊仍难区分。`gold_v1` 参与开发，不能当独立验证；`gold_v2` 已冻结，不用于继续调参。

## 2. Mock 版

Mock Provider 使用 30 条人工编写的合成工程案例验证 Schema、上下文、冲突、低置信、风险前置和失败降级。它的价值是可重复测试适配器边界，并不模拟真实模型质量，更不是临床准确率。

## 3. 真实 DeepSeek 版

30 条合成案例、3 轮结果：

| 指标 | 结果 |
|---|---:|
| Schema valid rate | 96.30% |
| Slot precision | 77.27% |
| Slot recall | 58.93% |
| Exact match | 65.74% |
| Evidence grounding | 100% |
| Risk preemption | 100% |
| Invalid-output rejection | 100% |
| Diagnosis leakage | 0 |
| Medication leakage | 0 |
| Run-to-run consistency | 80% |
| Average latency | 5856.52 ms |

## 4. 如何解读

1. precision 和 recall 没有达到满分，特别是 recall 表明模型会漏掉可提取信息；不能把“能返回合法 JSON”混同为“理解正确”。
2. Schema 非法、证据不落地、低置信或服务不可用时，系统回退标准规则流程，不让失败结果进入状态机。
3. 项目优先保证 risk preemption、evidence grounding 和零诊断/药物泄漏，而不是追求填满所有槽位。
4. Strict Function Calling 在当前模型/账户下不稳定，因此默认直接使用 `json_object`；输出仍需经过相同的服务端与 Harness 校验。
5. 以上全是合成语言工程指标。它们不能证明临床安全、疾病识别能力或对真实患者的有效性。
