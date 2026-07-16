# MedAsk 腹痛二次裁决标签指南 v2

> 本指南只用于18—65岁成人腹痛候选的患者侧语言标签裁决。它不是临床诊断或完整分诊标准，不提供疾病、药物、剂量或治疗建议。

## 1. 第一轮口径问题

第一轮 `human_current_symptom` 没有明确“当前性属于哪个主诉”。当文本同时存在当前头晕、发热、呕吐等症状，但腹痛是历史、已缓解或根本未出现时，审核者可能因“记录中有当前症状”选择 `yes`。因此该字段不再用于候选腹痛最终当前性。

风险字段 `human_risk_expression` 也没有区分腹痛模块特异风险和全局其他风险，导致咯血、血尿或其他需全局关注的表达可能被错误计入腹痛风险草案漏标。

## 2. 盲审流程

二次裁决只处理固定7个 `review_id`。第二名审核者在第一阶段只能看到患者侧 `title` 和 `ask`，看不到：

- 第一轮人工标签；
- 抽样分层和抽样器预测；
- 医生回答；
- 任何模型标签或解释。

7条二次标签全部完成后，工具才显示两轮标签并进入最终裁决。若没有第二名审核者，可由同一审核者间隔后盲审，但汇总报告必须注明这一限制。

启动命令：

```powershell
cd C:\Users\Owner\Documents\medask-mvp
C:\Users\Owner\Documents\medical-intake-data\.venv\Scripts\python.exe -m streamlit run tools\abdominal_adjudication_mode.py
```

每次保存会按 `review_id` 即时写入独立裁决文件，并在 `reports/abdominal-pain-adjudication-backups/` 保留最近10份备份。中断后可继续，第一轮CSV不会被写入。

## 3. 候选主诉当前性

### `human_candidate_current`

问题固定为：“候选主诉 `abdominal_pain` 是否属于当前或近期本次腹痛？”

- `yes`：腹痛当前仍存在，或近期本次发作在文本最后状态仍为当前。
- `no`：腹痛为已缓解、历史、否定或假设；即使存在其他当前症状也必须选 `no`。
- `uncertain`：无法判断腹痛主体、时间或最后状态；必须在备注说明语言歧义。

### `human_candidate_status`

- `current`：当前或近期本次仍存在。
- `resolved`：近期本次曾发生，但已经缓解或消失。
- `historical`：纯历史事件，不属于本次当前过程。
- `negated`：明确否认腹痛。
- `hypothetical`：假设、担忧未来发生或疾病知识。
- `uncertain`：无法可靠判断。

一致性约束：`current=yes`只能配`status=current`；`current=no`必须配`resolved/historical/negated/hypothetical`；`current=uncertain`只能配`status=uncertain`。

当前存在腰痛、胸痛、头痛、头晕、恶心或发热，但没有当前腹痛时，候选腹痛仍标 `no`。近期腹痛已经缓解时标 `resolved`，不等同于当前 `yes`。出现“以前没有，后来再次腹痛”等转折时，以后半句最后状态为准。

## 4. 最终主诉与意图

`human_candidate_complaints`允许多选并以竖线保存。只有患者侧文本明确表达腹部区域疼痛时才包含 `abdominal_pain`；单纯腹胀、恶心、反酸、胃口差、腰痛、胸痛或经期不适不能自动映射为腹痛。

`human_candidate_intent`沿用现有意图体系。问药、报告解读、医院费用、疾病知识、已确诊随访和儿童孕产妇应分别标记对应意图，不能仅因出现腹痛词而归为症状预问诊。

## 5. 风险存在性与scope

### `human_risk_present`

- `yes`：患者侧文本中存在当前或近期需确定性风险引擎关注的明确语言表达。
- `no`：不存在，或仅是否定、纯历史、已缓解、假设表达。
- `uncertain`：风险主体、当前性或语义不清；必须写明原因。

### `human_risk_scope`

- `abdominal_specific`：属于腹痛模块冻结风险草案。
- `global_other`：确有其他全局风险表达，但不能计入腹痛风险草案漏标。
- `uncertain`：无法确定scope。
- `none`：没有风险表达；必须与`risk_present=no`搭配。

### `human_risk_category`

- `sudden_severe_abdominal_pain`
- `hematemesis`
- `hematochezia_or_melena`
- `distension_no_stool_or_gas`
- `syncope_or_altered_consciousness`
- `severe_breathing_difficulty`
- `hemoptysis`
- `hematuria`
- `other`
- `none`

腹痛特异风险只包括突然剧烈腹痛、呕血、明显便血或黑便、明显腹胀且无法排便排气、腹痛同时晕厥/意识异常、腹痛同时严重呼吸困难。咯血、血尿等属于 `global_other`，不会计入腹痛草案漏标，但未来仍应由全局风险引擎在Provider之前处理。

风险标签只描述语言表达，不根据症状推断疾病。选择 `uncertain` 或 `other` 必须记录语言歧义原因。

## 6. 最终裁决

第二轮7条全部完成后，最终裁决者并排查看第一轮旧口径和第二轮V2口径，并填写：

- `final_candidate_current`
- `final_candidate_status`
- `final_complaints`
- `final_intent`
- `final_risk_present`
- `final_risk_scope`
- `final_risk_category`
- `final_reason_category`
- `final_notes`

裁决理由类别限定为标签定义更新、第一轮字段歧义、第二轮纠正、文本歧义、风险scope重分类或其他。最终字段单独保存，绝不覆盖第一轮标签。

## 7. V2开发门禁

门禁只使用最终裁决标签，不再把抽样分层直接当金标。必须明确分子、分母并单列 `uncertain`：

- 20/20标签可用于最终计算；
- 腹痛当前性规则准确率至少85%；
- 否定、历史、resolved误写为当前为0；
- 相邻非腹痛表达误识别为0；
- 不支持人群误入成人流程为0；
- 腹痛特异风险漏标为0；
- 全局其他风险正确转全局风险引擎；
- 未解决重大歧义为0。

任一安全硬门槛未通过即阻断。只补具体缺口5—10条，不重新随机审核120条，也不通过降低阈值换取放行。
