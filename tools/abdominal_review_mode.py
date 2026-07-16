#!/usr/bin/env python3
"""腹痛定向复核队列的轻量入口；复用数据项目已有审核工具的持久化能力。"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_PROJECT = Path(
    os.environ.get("MEDASK_DATA_PROJECT", PROJECT_ROOT.parent / "medical-intake-data")
).resolve()
QUEUE_CSV = PROJECT_ROOT / "reports" / "abdominal-pain-targeted-review.csv"
BACKUP_DIR = PROJECT_ROOT / "reports" / "abdominal-pain-review-backups"
REVIEW_TOOL = DATA_PROJECT / "tools" / "review_app.py"

KEY_COLUMN = "review_id"
HUMAN_FIELDS = (
    "human_is_valid",
    "human_current_symptom",
    "human_final_complaint",
    "human_intent",
    "human_risk_expression",
    "human_notes",
)
REQUIRED_HUMAN_FIELDS = HUMAN_FIELDS[:-1]
RISK_OPTIONS = ("yes", "no", "uncertain")


def load_shared_review_tool() -> ModuleType:
    """动态加载已有审核工具，避免复制其备份和原子写入实现。"""

    if not REVIEW_TOOL.is_file():
        raise FileNotFoundError(f"未找到可复用审核工具：{REVIEW_TOOL}")
    if str(DATA_PROJECT) not in sys.path:
        sys.path.insert(0, str(DATA_PROJECT))
    spec = importlib.util.spec_from_file_location("medical_data_review_app", REVIEW_TOOL)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载现有审核工具")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def validate_queue(fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    """验证本模式只接收固定20条腹痛队列，且绝不包含医生回答。"""

    required = {
        KEY_COLUMN,
        "source_row_id",
        "title",
        "ask",
        "candidate_complaint",
        "sampling_reason",
        *HUMAN_FIELDS,
    }
    missing = required - set(fieldnames)
    if missing:
        raise ValueError(f"审核队列缺少字段：{sorted(missing)}")
    forbidden = {"answer", "original_answer", "doctor_answer"} & set(fieldnames)
    if forbidden:
        raise ValueError(f"审核队列含禁止字段：{sorted(forbidden)}")
    if len(rows) != 20:
        raise ValueError(f"审核队列必须恰好20条，当前为{len(rows)}条")
    ids = [row[KEY_COLUMN].strip() for row in rows]
    if not all(ids) or len(ids) != len(set(ids)):
        raise ValueError("review_id 必须非空且唯一")
    if any(row["candidate_complaint"] != "abdominal_pain" for row in rows):
        raise ValueError("本入口只能加载 abdominal_pain 队列")


def is_reviewed(row: dict[str, str]) -> bool:
    """备注允许为空，其余五个人工字段填写完整才计为已审核。"""

    return all((row.get(field) or "").strip() for field in REQUIRED_HUMAN_FIELDS)


def save_annotation(
    shared: ModuleType,
    review_id: str,
    annotation: dict[str, str],
) -> None:
    """按稳定主键即时落盘；写入前备份，最多保留10份。"""

    with shared.SAVE_LOCK:
        fieldnames, rows = shared.load_csv(QUEUE_CSV)
        validate_queue(fieldnames, rows)
        indexes = {row[KEY_COLUMN]: index for index, row in enumerate(rows)}
        if review_id not in indexes:
            raise KeyError(f"未知 review_id：{review_id}")
        updated = dict(rows[indexes[review_id]])
        updated.update(annotation)
        rows[indexes[review_id]] = updated
        shared.create_backup(QUEUE_CSV, BACKUP_DIR, keep=10)
        shared.atomic_write_csv(QUEUE_CSV, fieldnames, rows)


def main() -> None:
    """运行腹痛定向人工审核界面。"""

    import streamlit as st

    st.set_page_config(page_title="腹痛边界定向复核", layout="wide")
    st.title("腹痛边界定向人工复核（20条）")
    st.caption("仅审核患者侧 title / ask；不显示医生回答，不生成诊断或治疗建议。")

    try:
        shared = load_shared_review_tool()
        fieldnames, rows = shared.load_csv(QUEUE_CSV)
        validate_queue(fieldnames, rows)
    except Exception as error:  # 页面仅显示受控错误，不打印患者文本。
        st.error(f"审核队列无法加载：{error}")
        st.stop()

    reviewed_count = sum(is_reviewed(row) for row in rows)
    unreviewed_count = len(rows) - reviewed_count
    col_total, col_reviewed, col_pending = st.columns(3)
    col_total.metric("总记录", len(rows))
    col_reviewed.metric("已审核", reviewed_count)
    col_pending.metric("未审核", unreviewed_count)

    only_unreviewed = st.checkbox("只查看未审核记录", value=True)
    visible_rows = [row for row in rows if not is_reviewed(row)] if only_unreviewed else rows
    if not visible_rows:
        st.success("当前筛选范围已全部完成。")
        st.stop()

    visible_ids = [row[KEY_COLUMN] for row in visible_rows]
    current_id = st.session_state.get("abdominal_review_id")
    if current_id not in visible_ids:
        current_id = visible_ids[0]
        st.session_state["abdominal_review_id"] = current_id

    jump_id = st.selectbox("按 review_id 跳转", visible_ids, index=visible_ids.index(current_id))
    if jump_id != current_id:
        st.session_state["abdominal_review_id"] = jump_id
        st.rerun()

    index = visible_ids.index(current_id)
    row = visible_rows[index]
    st.subheader(f"{index + 1} / {len(visible_rows)} · {row[KEY_COLUMN]}")
    st.write("候选主诉：`abdominal_pain`")
    st.write(f"抽样分层：`{row['sampling_reason']}`")

    title_col, ask_col = st.columns(2)
    with title_col:
        st.markdown("#### 原始 title")
        st.info(row["title"] or "（空）")
    with ask_col:
        st.markdown("#### 原始 ask")
        st.warning(row["ask"] or "（空）")

    yes_no_uncertain = list(shared.VALIDITY_OPTIONS)
    current_values = {field: (row.get(field) or "").strip() for field in HUMAN_FIELDS}
    valid = st.radio(
        "文本是否有效",
        yes_no_uncertain,
        index=yes_no_uncertain.index(current_values["human_is_valid"]) if current_values["human_is_valid"] in yes_no_uncertain else None,
        horizontal=True,
    )
    current = st.radio(
        "是否为当前/近期本次症状",
        yes_no_uncertain,
        index=yes_no_uncertain.index(current_values["human_current_symptom"]) if current_values["human_current_symptom"] in yes_no_uncertain else None,
        horizontal=True,
    )
    selected_complaints = st.multiselect(
        "最终主诉（可多选）",
        list(shared.COMPLAINT_OPTIONS),
        default=[value for value in current_values["human_final_complaint"].split("|") if value],
    )
    intent_options = list(shared.INTENT_OPTIONS)
    intent = st.selectbox(
        "咨询意图",
        [""] + intent_options,
        index=([""] + intent_options).index(current_values["human_intent"]) if current_values["human_intent"] in intent_options else 0,
    )
    risk = st.radio(
        "是否含需单独标记的高风险表达（仅语言标签，不推断疾病）",
        list(RISK_OPTIONS),
        index=list(RISK_OPTIONS).index(current_values["human_risk_expression"]) if current_values["human_risk_expression"] in RISK_OPTIONS else None,
        horizontal=True,
    )
    notes = st.text_area("审核备注（可空）", value=current_values["human_notes"], max_chars=1000)

    def navigate(offset: int) -> None:
        target = min(max(index + offset, 0), len(visible_ids) - 1)
        st.session_state["abdominal_review_id"] = visible_ids[target]

    def persist(offset: int) -> None:
        if not valid or not current or not selected_complaints or not intent or not risk:
            st.error("请填写除备注外的全部人工字段。")
            return
        annotation = {
            "human_is_valid": valid,
            "human_current_symptom": current,
            "human_final_complaint": shared.normalize_multi_labels(selected_complaints),
            "human_intent": intent,
            "human_risk_expression": risk,
            "human_notes": notes.strip(),
        }
        save_annotation(shared, row[KEY_COLUMN], annotation)
        navigate(offset)
        st.rerun()

    previous_col, skip_col, next_col = st.columns(3)
    if previous_col.button("保存并上一条", use_container_width=True, disabled=index == 0):
        persist(-1)
    if skip_col.button("跳过", use_container_width=True):
        navigate(1)
        st.rerun()
    if next_col.button("保存并下一条", use_container_width=True):
        persist(1)


if __name__ == "__main__":
    main()
