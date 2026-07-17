# 腹痛7条定向二次裁决汇总

> 本流程只使用患者侧文本，不使用医生answer；不代表临床准确率或完整临床分诊。

## 数据保护

- 第一轮CSV SHA-256：`3c0a677b3b18806113ef7d4fcab3b121b3dddd03aaf1df0f03016c4a928acf80`，与冻结值一致。
- 二次裁决文件：7条、review_id唯一7条；不包含第一轮标签、抽样分层或医生回答。
- 第二轮人工完成：7/7。
- 最终裁决完成：7/7。

## 口径修复

- 第一轮 `human_current_symptom` 是记录级模糊字段，无法保证回答的是腹痛当前性。
- V2改为 `human_candidate_current`，问题固定为候选腹痛是否属于当前或近期本次腹痛，并用 `human_candidate_status` 区分current/resolved/historical/negated/hypothetical/uncertain。
- 风险拆成present、scope和category；`abdominal_specific`计入腹痛风险草案，`global_other`只路由全局风险引擎。

## 当前状态

7条二次盲审和最终裁决均已完成，可计算V2门禁。

## 方法限制

优先由第二名审核者完成。若实际由同一审核者间隔后复核，必须在最终备注中记录；这不是独立双人一致性研究。抽样分层不是金标，不再作为V2准确率的唯一分母。
