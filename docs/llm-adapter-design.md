# MedAsk 受控大模型适配层设计

## 目标

适配层只负责把当前一轮自由文本转换为现有槽位候选，或改写一个既有问题的表达。它不能直接操作 `IntakeSession`，不能决定状态、风险升级、最大轮数、问题依赖或最终摘要。

当前实现只有固定映射的 `MockLlmProvider`，没有真实模型API、API Key或网络模型调用。

## 固定处理流程

```text
User Input
  ↓
Deterministic Risk Check
  ├─ 命中 → Harness立即escalated，Provider调用次数为0
  └─ 未命中
       ↓
LLM Candidate Extraction（最小请求）
       ↓
Strict Schema Validation（拒绝额外字段）
       ↓
Slot Validation（类型、枚举、30—45℃等）
       ↓
Deterministic Risk Re-check（evidence与候选值）
       ↓
Acceptance Policy（置信度、状态、证据、否定、冲突、风险槽位）
       ↓
Harness State Transition
```

## 职责边界

### Provider可以做

- 根据当前文本提出允许范围内的槽位候选。
- 返回候选值、置信度、原文证据和断言状态。
- 在开发模式下改写一个既有标准问题的措辞。

### Provider不能做

- 接收完整会话、完整Trace、升级原因、规则优先级或历史原文全集。
- 访问风险规则实现或调用Harness控制函数。
- 写入answers、覆盖既有答案、改变status或取消升级。
- 修改required、showWhen、maxTurns或槽位定义。
- 生成诊断、概率、处方、药物、剂量、治疗方案或最终摘要。

## 严格Schema

槽位输出只允许：

```json
{
  "schemaVersion": "1.0",
  "candidates": [
    {
      "slotId": "onset",
      "value": "昨天",
      "confidence": 0.94,
      "evidence": "昨天开始",
      "status": "asserted"
    }
  ],
  "unresolved": [],
  "needsClarification": false
}
```

顶层和候选对象都采用精确字段集合。非法JSON、版本不符、多余字段、未知状态、越界置信度或过长证据会使整次输出失败，不会静默删除字段后继续。

## 接受策略

候选自动写入必须同时满足：

- `confidence >= 0.90`；
- `status = asserted`；
- evidence是当前用户原文的短片段；
- slotId属于本轮允许槽位；
- 值通过槽位类型、枚举和范围校验；
- 与已有答案不冲突；
- 不与局部否定表达矛盾；
- evidence和候选值均未触发风险规则；
- 不是胸痛、呼吸困难或意识相关风险槽位。

模型永远不能自动确认风险槽位。风险表达由Harness在模型调用前处理；模型输出后，确定性风险引擎还会复查证据与候选值。

## 冲突与澄清

既有答案不会被模型覆盖。适配器输出 `SlotConflict`，Harness使用固定模板生成澄清问题。例如：

> 你之前提供的是38.5℃，现在提到37℃。请确认当前体温是多少？

低置信、uncertain或全部候选被拒绝时，保留当前标准问题并显示固定澄清文本。模型不自行解决冲突。

## 失败与超时

每个操作只有一次Provider调用，并有超时限制；不自动重试。异常、超时、非法Schema或非法改写都会回退到标准问题。同步规则API保持不变，关闭适配器时行为与原版本一致。

## 问题改写

问题改写只替换页面显示文本：

- 输出必须通过严格Schema与policyGuard；
- 必须保留标准问题中的核心医学概念；
- 不得增加标准问题没有的新医学概念；
- 不修改槽位ID和任何槽位规则；
- 失败时直接显示canonicalQuestion。

## 非敏感Trace

LLM Trace只记录请求ID、Provider名称、操作、版本、延迟、结果、接受/拒绝数量和拒绝原因。不记录userText、evidence、原始模型输出、API Key或个人信息。

## 离线评测

`src/llm/evals/slotExtractionCases.ts`包含30条人工编写合成案例，覆盖明确、否定、历史、缓解、复发、模糊、多槽位、数字、冲突、风险和非法输出。指标是工程离线评测，不是临床准确率。
