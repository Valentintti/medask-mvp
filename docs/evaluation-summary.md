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

## 5. 腹痛实验性规则版

腹痛人工门禁未完全通过。因项目时间约束，规则版与 Mock 版以 `experimental` 状态实现，采用保守字面边界、固定澄清和 Provider 前风险拦截；真实 Provider 不放行 `abdominal_pain`。现有AI暂定标签、20条复核、8条补充和既有合成案例只用于设计与回归，均不被表述为人工金标。

本轮使用既有33条人工编写的腹痛合成设计案例，并补充13项合成边界/风险检查。孤立的冲突追问片段依赖已有会话上下文，不进入首句主诉识别分母。聚合结果如下：

| 合成工程指标 | 结果 |
|---|---:|
| 主诉识别准确率 | 38/38（100.0%） |
| 当前性识别准确率 | 38/38（100.0%） |
| 相邻非腹痛表达假阳性 | 0 |
| 否定/历史/resolved误写为当前 | 0 |
| 风险前置率 | 4/4（100.0%） |
| 否定或非当前风险误触发 | 0 |
| 不支持人群分流 | 2/2（100.0%） |
| 多主诉共享槽位重复 | 0 |
| 摘要编造 | 0 |

这些结果只说明固定合成文本下的规则行为可重复，不表示腹痛数据门禁通过，也不是临床准确率、完整分诊验证或真实人群效果。
