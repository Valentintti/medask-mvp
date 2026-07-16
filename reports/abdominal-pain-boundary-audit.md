# 腹痛患者侧边界审计

> 本报告只分析患者侧 `title/ask/patient_text` 与既有人工标签，不读取或使用医生 `answer`。统计用于语言标签与产品规则设计，不代表临床准确率、诊断能力或医疗安全性。

## 数据范围与完整性

- gold_v1 腹痛：20 条。
- gold_v2 腹痛：10 条。
- 合并人工标签：30 条，review_id 唯一 30 条。
- 严格当前腹痛：25/30。定义为 `is_valid=yes`、`current_symptom=yes` 且最终多标签包含 `abdominal_pain`。
- 非空人工备注：27/30；只用于聚合审计，不引用备注原文。
- 排除所有 gold 的 review_id、source_row 和规范化 title+ask 后，剩余腹痛字面候选 69 条。
- 所有源文件均未读取医生 `answer` 字段。

| 源文件 | SHA-256 |
|---|---|
| reports/im_manual_review.csv | `ebe36ffbbeb47f5ed0610582471c6731acf568e62f20404a82d0ef2e3ec299a3` |
| reports/gold/im_manual_review_gold_v1.csv | `97df9acf86e4d9fd0ba5de285e3a378c0eca0da49183799f116ef90acff159fd` |
| reports/validation/gold/im_validation_gold_v2.csv | `3f7b3af1e4b18398e9a00fca5d46f4a99eafa9c28fe5df98f500d8de861927c4` |

## 人工标签分布

### 当前性

| 标签 | 数量 |
|---|---:|
| `uncertain` | 4 |
| `yes` | 26 |

### 咨询意图

| 标签 | 数量 |
|---|---:|
| `diagnosed_followup` | 4 |
| `disease_knowledge` | 5 |
| `hospital_or_cost` | 2 |
| `medication_query` | 2 |
| `pediatric_or_pregnancy` | 2 |
| `symptom_intake` | 14 |
| `uncertain` | 1 |

人工最终标签包含腹痛 29/30；多标签较多，不能把“包含腹痛”解释成单一腹痛。

## 边界信号（可重叠）

| 边界 | 数量 | 说明 |
|---|---:|---|
| 当前肯定腹痛（严格人工定义） | 25 | 产品正例基础 |
| 否定腹痛 | 0 | 不得写入当前槽位 |
| 历史腹痛 | 1 | 不得写入当前槽位 |
| 已缓解腹痛 | 1 | 可整理本次经过，但标记resolved |
| 假设或疾病知识 | 7 | 不等于当前症状预问诊 |
| 模板/错配 | 2 | 需判断文本有效性 |
| 儿童或孕产妇 | 3 | 当前成人产品不支持 |
| 腹胀、恶心、反酸、胃部不适等相邻表达 | 3 | 没有疼痛证据时不得补写腹痛 |
| 腰痛、胸痛、经期不适等非目标疼痛 | 0 | “痛”不能跨部位泛化 |

意图层风险：已确诊随访 4，问药 2，报告解读 0，医院/费用 2。

## 主要边界问题

1. 正例占比高：严格当前腹痛为 25/30；否定、历史、已缓解和纯相邻表达的人工负例不足。
2. 既有标签包含疾病知识、随访、问药、医院费用和不支持人群，字面命中不能替代意图路由。
3. 最终标签经常为多主诉组合，未来规则不能强压成单标签。
4. 腹胀、恶心、反酸、胃部不适既可共现也可独立出现，没有疼痛证据时不得自动补写腹痛。
5. 高风险表达需要独立人工字段与未来确定性规则，不能由疾病推断代替。

## 定向抽样结果

固定随机种子：`20260717`。

| 分层 | 数量 |
|---|---:|
| `adjacent_expression_without_pain` | 4 |
| `current_affirmed` | 4 |
| `mismatch_template_invalid` | 3 |
| `negated_historical_resolved` | 4 |
| `possible_risk_expression` | 3 |
| `unsupported_population` | 2 |

- 总计：20 条；review_id、source_row_id、规范化 title+ask 均唯一。
- 与 gold_v1/gold_v2 的 review_id、source_row 和规范化 title+ask 重合：0。
- 人工字段初始非空：0。
- 可用相邻表达硬负例共 11 条，来自尚未进入gold的更广泛患者侧候选池；剩余腹痛字面候选没有足够的“未明确疼痛”记录。队列选取其中4条并用 `sampling_reason` 标记，避免伪装覆盖。
- 排除gold的source_row与文本后，原腹痛字面池只有1条不支持人群记录；队列从 2 条“明确腹痛+不支持人群”的更广泛未入gold候选中补足第2条。
- CSV 不包含医生answer。

## 开发门禁

人工审核完成后才计算：20条全部完成；当前腹痛与非腹痛边界一致率≥85%；否定/历史/已缓解误写当前=0；不支持人群误入成人流程=0；高风险漏标=0；无重大标签歧义。未达到时只补具体缺口，不重新随机120条。
