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
Evidence Context Check（在完整userText定位全部出现位置）
       ↓
Acceptance Policy（置信度、时间状态、冲突、风险槽位）
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
  "schemaVersion": "1.1",
  "candidates": [
    {
      "slotId": "onset",
      "value": "昨天",
      "confidence": 0.94,
      "evidence": "昨天开始",
      "status": "asserted"
    }
  ],
  "unresolvedSlotIds": [],
  "needsClarification": false
}
```

顶层和候选对象都采用精确字段集合。`unresolvedSlotIds`的每个值必须属于请求中的`allowedSlotIds`，不能承载自由医学描述。非法JSON、请求/响应版本不符、多余字段、未知槽位或状态、越界置信度、过长证据，以及diagnosis、treatment、medication等额外键都会使整次输出失败，不会静默删除字段后继续。

候选状态为：`asserted | negated | uncertain | historical | resolved | hypothetical`。只有asserted具备自动写入资格；其他状态仅产生非敏感拒绝原因或固定澄清，不写入当前症状槽位。

## 接受策略

候选自动写入必须同时满足：

- `confidence >= 0.90`；
- `status = asserted`；
- evidence是当前用户原文的短片段；
- slotId属于本轮允许槽位；
- 值通过槽位类型、枚举和范围校验；
- evidence在完整userText中的相关出现位置至少有一个属于当前肯定语境；
- 与已有答案相同则作为no-op，不重复写入或增加轮数；不同则进入冲突澄清；
- evidence和候选值均未触发风险规则；
- 不是胸痛、呼吸困难或意识相关风险槽位。

模型永远不能自动确认风险槽位。风险表达由Harness在模型调用前处理；模型输出后，确定性风险引擎还会复查证据与候选值，控制器写入前再做一次槽位、风险和既有值校验。

### evidence局部语境

适配器不会只分析模型返回的片段。它在完整userText中定位evidence的全部位置，并优先定位与目标槽位相关、和evidence范围重叠的症状词，再截取局部子句判断：

- 全部是否定：`negation_conflict`；
- 全部为历史：`historical_context`；
- 全部已缓解：`resolved_context`；
- 全部为假设或未来：`hypothetical_context`；
- 至少一个位置为当前肯定：asserted候选才可继续后续校验。

因此原文“没有发热”即使模型只返回`evidence="发热"`也会被拒绝；原文“没有胸痛，但后来突然胸痛”中的两个位置会分别判定，后半句仍由前置风险引擎升级。

## 冲突与澄清

既有答案不会被模型覆盖。适配器输出 `SlotConflict`，Harness使用固定模板生成澄清问题。例如：

> 你之前提供的是38.5℃，现在提到37℃。请确认当前体温是多少？

低置信、uncertain或全部候选被拒绝时，保留当前标准问题并显示固定澄清文本。模型不自行解决冲突。

## 失败与超时

每个操作只有一次Provider调用，并有超时限制；不自动重试。`withProviderTimeout`创建AbortController，超时时主动abort底层Provider；页面卸载、会话重启或新一轮请求也会向Provider传递取消信号。调用方按sessionId和会话代次隔离结果，迟到响应不能写入新会话。异常、超时、非法Schema或非法改写都会回退到标准问题。同步规则API保持不变，关闭适配器时行为与原版本一致。

## 问题改写

问题改写只替换页面显示文本：

- 输出必须通过严格Schema与policyGuard；
- 风险槽位（胸痛、呼吸困难、意识相关）Provider调用次数固定为0；
- 必须保留否定极性、时间范围、问句类型、数值单位和是否必答含义；
- 不得增加标准问题没有的疾病、药物、检查、治疗建议或风险程度判断；
- 不修改槽位ID和任何槽位规则；
- 失败时直接显示canonicalQuestion。

## 非敏感Trace

LLM Trace只记录请求ID、Provider名称、操作、版本、延迟、结果、接受/拒绝数量和拒绝原因。不记录userText、evidence、原始模型输出、API Key或个人信息。

## 离线评测

`src/llm/evals/slotExtractionCases.ts`包含30条人工编写合成案例，覆盖明确、否定、历史、缓解、复发、模糊、多槽位、数字、冲突、风险和非法输出。

评测分别报告：valid extraction case count、有效案例slot precision/recall/exact match、pipeline outcome accuracy、非法输出拒绝率、风险前置率、低置信拒绝率、uncertain澄清率、冲突路由准确率、幻觉证据数和错误风险覆盖数。风险与非法输出不进入有效提取exact-match分母；没有目标槽位的空集合也不会无条件提高准确率。每个比率同时保留分子和分母，评测可重复。

这些仅是Mock与合成数据上的工程回归指标，不是临床准确率。AI一致或高置信不等于正确。

## 真实Provider前置条件

当前仍未连接真实模型API。真实Provider必须支持AbortSignal、输入最小化与脱敏、限流、超时、Schema 1.1版本协商和迟到响应隔离；不得记录患者原文、evidence、密钥或原始输出到浏览器控制台和会话Trace。
