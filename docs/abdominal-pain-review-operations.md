# 腹痛20条定向复核操作说明

本入口复用 `medical-intake-data/tools/review_app.py` 的 CSV 读取、稳定主键保存、原子写入、备份轮转和多标签校验能力，只加载本阶段固定的20条腹痛患者侧文本。

## 启动前提

- MedAsk 项目：`C:\Users\Owner\Documents\medask-mvp`
- 数据项目：`C:\Users\Owner\Documents\medical-intake-data`
- 审核队列：`reports/abdominal-pain-targeted-review.csv`
- Python环境：沿用数据项目现有 `.venv`

默认按两个项目处于同一父目录定位数据项目。如位置不同，可设置 `MEDASK_DATA_PROJECT`，其值只能指向本机的数据项目目录。

## 启动命令

```powershell
cd C:\Users\Owner\Documents\medask-mvp
C:\Users\Owner\Documents\medical-intake-data\.venv\Scripts\python.exe -m streamlit run tools\abdominal_review_mode.py
```

页面只展示 `title`、`ask`、候选主诉和抽样分层，不加载或展示医生 `answer`。

## 需要填写的字段

- `human_is_valid`：`yes` / `no` / `uncertain`
- `human_current_symptom`：`yes` / `no` / `uncertain`
- `human_final_complaint`：允许多选，保存为竖线分隔字符串
- `human_intent`：使用现有人工审核意图枚举
- `human_risk_expression`：`yes` / `no` / `uncertain`，只标记风险语言表达
- `human_notes`：可为空，仅记录必要边界原因

具体定义以 `docs/abdominal-pain-labeling-guide.md` 为准。`sampling_reason` 只用于覆盖检查，不是人工答案。

## 保存、备份与续审

- 每次保存以 `review_id` 为稳定主键即时写回定向队列。
- 写入前备份到 `reports/abdominal-pain-review-backups/`，只保留最近10份。
- 再次启动时读取现有进度，不重新生成或覆盖队列。
- 本入口不写入或覆盖 `gold_v1`、`gold_v2` 和原有600条审核文件。
- 患者侧全文不会主动打印到控制台；受控错误只显示结构或路径问题。

## 完成后的门禁

完成20条前不计算开发放行结论。完成后按冻结门槛计算边界一致率、非当前误写、不支持人群误入和风险漏标；若未通过，只补具体缺口，不重新随机抽取大规模样本。
