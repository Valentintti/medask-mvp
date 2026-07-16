# MedAsk V2 头痛与头晕 Provider 增量评测报告

> 2026-07-17。全部案例为人工合成语言工程案例，不是真实患者数据；本报告不代表临床准确率、诊断能力或医疗安全性。报告不包含用户原文、evidence 原文、API Key、Authorization 或完整模型响应。

## 结论

- 第一轮结构失败的唯一类别是 `truncated_output`：上游 HTTP 200，但 `finish_reason=length`，Provider 按安全策略拒绝截断 JSON。
- 将槽位提取专用输出预算从 1,200 提高到 4,096 后，第一关 Schema valid 达到 12/12；Schema、evidence、风险前置和泄漏安全门槛均通过。
- 第一关质量门槛未通过：precision 62.50%、recall 83.33%、exact match 44.44%。因此按预设停止条件没有运行 20 条第二关，也没有运行 50条×3轮正式评测。
- 规则版的 headache/dizziness 支持不受影响；真实 Provider 对这两类新增主诉仍标记为 `experimental/disabled`，不得据此宣称已放行。

## 产品状态

- GitHub Pages 纯前端规则版支持 `fever`、`cough`、`headache`、`dizziness`，且不调用真实 Provider。
- 真实 Provider 生产 API 仅保持原已验证范围：`fever`、`cough`。
- `headache`、`dizziness` 的固定合成案例、评测脚本和失败报告被保留，但生产 Prompt 中针对这批固定案例增加的槽位指导已经撤销。
- 提高到 4,096 的输出预算是通用结构完整性修复；完整 Schema、逐字 evidence、confidence、Acceptance Policy 和 Harness 门槛均未降低。
- 结构安全通过只表示输出契约和防护链有效，不代表字段语义准确，更不代表临床准确率。

## 脱敏根因

结构诊断未发现以下问题：缺字段、多余字段、非法枚举、未知 slotId、错误 value 类型、Schema 版本不一致或 `unresolvedSlotIds` 越权。

截断修复后的质量差异为：

- headache：目标为 `headacheLocation`、`headachePattern`，三轮均额外接受 `headacheSensation`。模型把位置/规律之外的疼痛修饰语继续映射成体验槽位，导致 precision 和非空 exact match 下降。
- dizziness：目标为 `dizzinessTrigger`、`dizzinessEpisodeDuration`。一轮额外接受 `dizzinessExperience`；另有一轮返回 `dizzinessPattern` 但因低置信度被拒绝。`dizzinessEpisodeDuration` 在两轮出现值级不一致，说明“体验、规律、诱因、单次时长”的边界仍不稳定。
- 否定案例有一轮返回多个 `negated` 候选，但 Acceptance Policy 全部拒绝，没有写入当前答案。

## 第一关指标（5条×3轮）

| 指标 | 结果 | 门槛 | 结论 |
|---|---:|---:|---|
| 非风险真实调用 | 12 | 12 | 完整 |
| Schema valid | 12/12（100%） | 100% | 通过 |
| Evidence grounding | 25/25（100%） | 100% | 通过 |
| Risk preemption | 3/3（100%） | 100% | 通过 |
| Invalid output rejection | 3/3（100%） | 100% | 通过 |
| Slot precision | 10/16（62.50%） | ≥80% | 未通过 |
| Slot recall | 10/12（83.33%） | ≥75% | 通过 |
| Exact match | 4/9（44.44%） | ≥50% | 未通过 |
| Historical write-in | 0 | 0 | 通过 |
| Resolved-as-current | 0 | 0 | 通过 |
| Diagnosis leakage | 0 | 0 | 通过 |
| Medication leakage | 0 | 0 | 通过 |

三轮接受结果一致性为 3/5（60%），平均调用延迟约 10,992.58 ms。以上均为合成语言工程指标。

## 停止与发布决定

第一关失败后已停止真实调用。未进入 20 条分层评测，未进入 50条×3轮正式评测，也未继续针对冻结案例调 Prompt。现有严格 Schema、逐字 evidence、风险前置、Acceptance Policy 和 Harness 控制权保持不变。
