#!/usr/bin/env python3
"""腹痛风险路由6条患者侧盲审入口。"""

from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
from abdominal_adjudication_mode import RISK_CATEGORY_OPTIONS, RISK_PRESENT_OPTIONS, RISK_SCOPE_OPTIONS, select_with_blank, widget_key  # noqa: E402
from abdominal_review_mode import load_shared_review_tool  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
QUEUE = ROOT / "reports" / "abdominal-pain-risk-targeted-review.csv"
BACKUPS = ROOT / "reports" / "abdominal-pain-risk-review-backups"
STATUS_OPTIONS = ("current", "negated", "historical", "resolved", "hypothetical", "uncertain")
FIELDS = ("human_risk_present", "human_risk_status", "human_risk_scope", "human_risk_category")


def complete(row: dict[str, str]) -> bool:
    return all((row.get(field) or "").strip() for field in FIELDS)


def main() -> None:
    st.set_page_config(page_title="腹痛风险路由盲审", layout="wide")
    st.title("腹痛风险路由定向盲审（6条）")
    st.caption("抽样分层和规则预测隐藏；只显示患者侧title/ask，不显示医生回答。")
    shared = load_shared_review_tool()
    fieldnames, rows = shared.load_csv(QUEUE)
    if len(rows) != 6 or len({row["review_id"] for row in rows}) != 6 or any("answer" in field.lower() for field in fieldnames):
        st.error("风险队列结构不合法，已停止。")
        st.stop()
    pending = [row for row in rows if not complete(row)]
    st.progress((6 - len(pending)) / 6, text=f"审核进度：{6 - len(pending)} / 6")
    visible = pending or rows
    selected = st.selectbox("review_id", [row["review_id"] for row in visible], key="risk_review_id")
    row = next(item for item in visible if item["review_id"] == selected)
    left, right = st.columns(2)
    left.info(row["title"] or "（空）")
    right.warning(row["ask"] or "（空）")
    present = select_with_blank("风险表达是否存在", RISK_PRESENT_OPTIONS, row["human_risk_present"], widget_key(selected, "risk_present"))
    status = select_with_blank("风险表达状态", STATUS_OPTIONS, row["human_risk_status"], widget_key(selected, "risk_status"))
    scope = select_with_blank("风险scope", RISK_SCOPE_OPTIONS, row["human_risk_scope"], widget_key(selected, "risk_scope"))
    category = select_with_blank("风险类别", RISK_CATEGORY_OPTIONS, row["human_risk_category"], widget_key(selected, "risk_category"))
    notes = st.text_area("备注（uncertain/other时必填）", value=row["human_notes"], key=widget_key(selected, "risk_notes"))
    if st.button("保存并下一条", type="primary", use_container_width=True):
        if not all([present, status, scope, category]):
            st.error("请填写全部风险字段。")
            return
        if present == "no" and (scope != "none" or category != "none"):
            st.error("无风险表达时scope和category必须为none。")
            return
        if present == "yes" and (scope == "none" or category == "none"):
            st.error("存在风险表达时必须选择具体scope和category。")
            return
        if (present == "uncertain" or status == "uncertain" or scope == "uncertain" or category == "other") and not notes.strip():
            st.error("uncertain或other必须填写备注。")
            return
        with shared.SAVE_LOCK:
            current_fields, current_rows = shared.load_csv(QUEUE)
            index = {item["review_id"]: offset for offset, item in enumerate(current_rows)}[selected]
            updated = dict(current_rows[index])
            updated.update({"human_risk_present": present, "human_risk_status": status, "human_risk_scope": scope, "human_risk_category": category, "human_notes": notes.strip()})
            current_rows[index] = updated
            shared.create_backup(QUEUE, BACKUPS, keep=10)
            shared.atomic_write_csv(QUEUE, current_fields, current_rows)
        st.rerun()


if __name__ == "__main__":
    main()
