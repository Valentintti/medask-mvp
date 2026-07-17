#!/usr/bin/env python3
"""腹痛门禁补充8条患者侧盲审入口。"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
from abdominal_adjudication_mode import (  # noqa: E402
    CURRENT_OPTIONS, RISK_CATEGORY_OPTIONS, RISK_PRESENT_OPTIONS, RISK_SCOPE_OPTIONS,
    STATUS_OPTIONS, select_with_blank, validate_semantics, widget_key,
)
from abdominal_review_mode import load_shared_review_tool  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "reports" / "abdominal-pain-followup-review.csv"
BACKUPS = ROOT / "reports" / "abdominal-pain-followup-review-backups"
FIELDS = (
    "human_candidate_current", "human_candidate_status", "human_candidate_complaints",
    "human_candidate_intent", "human_risk_present", "human_risk_scope", "human_risk_category",
)


def complete(row: dict[str, str]) -> bool:
    return all((row.get(field) or "").strip() for field in FIELDS)


def main() -> None:
    st.set_page_config(page_title="腹痛门禁补充复核", layout="wide")
    st.title("腹痛门禁补充盲审（8条）")
    st.caption("只显示患者侧title/ask；不显示医生回答，不生成诊断或治疗建议。")
    shared = load_shared_review_tool()
    fieldnames, rows = shared.load_csv(QUEUE)
    if len(rows) != 8 or len({row["review_id"] for row in rows}) != 8 or any("answer" in field.lower() for field in fieldnames):
        st.error("补充队列结构不合法，已停止。")
        st.stop()
    pending = [row for row in rows if not complete(row)]
    st.progress((8 - len(pending)) / 8, text=f"审核进度：{8 - len(pending)} / 8")
    visible = pending or rows
    selected = st.selectbox("review_id", [row["review_id"] for row in visible], key="followup_review_id")
    row = next(item for item in visible if item["review_id"] == selected)
    st.write(f"抽样原因：`{row['sampling_reason']}`")
    left, right = st.columns(2)
    left.info(row["title"] or "（空）")
    right.warning(row["ask"] or "（空）")
    current = select_with_blank("候选腹痛当前性", CURRENT_OPTIONS, row["human_candidate_current"], widget_key(selected, "follow_current"))
    status = select_with_blank("候选腹痛状态", STATUS_OPTIONS, row["human_candidate_status"], widget_key(selected, "follow_status"))
    complaints = st.multiselect("最终主诉", list(shared.COMPLAINT_OPTIONS), default=[item for item in row["human_candidate_complaints"].split("|") if item], key=widget_key(selected, "follow_complaints"))
    intent = select_with_blank("咨询意图", tuple(shared.INTENT_OPTIONS), row["human_candidate_intent"], widget_key(selected, "follow_intent"))
    risk_present = select_with_blank("风险存在性", RISK_PRESENT_OPTIONS, row["human_risk_present"], widget_key(selected, "follow_risk_present"))
    risk_scope = select_with_blank("风险scope", RISK_SCOPE_OPTIONS, row["human_risk_scope"], widget_key(selected, "follow_risk_scope"))
    risk_category = select_with_blank("风险类别", RISK_CATEGORY_OPTIONS, row["human_risk_category"], widget_key(selected, "follow_risk_category"))
    notes = st.text_area("备注（uncertain/other时必填）", value=row["human_notes"], key=widget_key(selected, "follow_notes"))
    if st.button("保存并下一条", type="primary", use_container_width=True):
        if not all([current, status, complaints, intent, risk_present, risk_scope, risk_category]):
            st.error("请填写除备注外的全部字段。")
            return
        error = validate_semantics({
            "human_candidate_current": current, "human_candidate_status": status,
            "human_risk_present": risk_present, "human_risk_scope": risk_scope,
            "human_risk_category": risk_category, "human_notes": notes,
        }, "human_")
        if error:
            st.error(error)
            return
        with shared.SAVE_LOCK:
            current_fields, current_rows = shared.load_csv(QUEUE)
            index = {item["review_id"]: offset for offset, item in enumerate(current_rows)}[selected]
            updated = dict(current_rows[index])
            updated.update({
                "human_candidate_current": current, "human_candidate_status": status,
                "human_candidate_complaints": shared.normalize_multi_labels(complaints),
                "human_candidate_intent": intent, "human_risk_present": risk_present,
                "human_risk_scope": risk_scope, "human_risk_category": risk_category,
                "human_notes": notes.strip(),
            })
            current_rows[index] = updated
            shared.create_backup(QUEUE, BACKUPS, keep=10)
            shared.atomic_write_csv(QUEUE, current_fields, current_rows)
        st.rerun()


if __name__ == "__main__":
    main()
