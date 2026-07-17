#!/usr/bin/env python3
"""腹痛补充5条最终盲裁；全部完成前不读取旧标签。"""

from __future__ import annotations

import csv
import hashlib
import sys
from pathlib import Path

import streamlit as st

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
from abdominal_adjudication_mode import (  # noqa: E402
    CURRENT_OPTIONS, REASON_OPTIONS, RISK_CATEGORY_OPTIONS, RISK_PRESENT_OPTIONS,
    RISK_SCOPE_OPTIONS, STATUS_OPTIONS, select_with_blank, validate_semantics, widget_key,
)
from abdominal_review_mode import load_shared_review_tool  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "reports" / "abdominal-pain-followup-review.csv"
QUEUE = ROOT / "reports" / "abdominal-pain-followup-adjudication.csv"
BACKUPS = ROOT / "reports" / "abdominal-pain-followup-adjudication-backups"
SOURCE_HASH = "9e37cc6a8b3a88c5ca796ed27b83e19328f829f008611ad553779566d51ab052"
FINAL_FIELDS = (
    "final_candidate_current", "final_candidate_status", "final_complaints", "final_intent",
    "final_risk_present", "final_risk_scope", "final_risk_category", "adjudication_reason",
)


def complete(row: dict[str, str]) -> bool:
    return all((row.get(field) or "").strip() for field in FINAL_FIELDS)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rule_status(row: dict[str, str]) -> str:
    """仅在全部盲裁完成后展示既有草案预测，不参与保存。"""

    text = f"{row['title']}。{row['ask']}"
    if any(term in text for term in ("如果", "假如", "会不会", "是什么", "什么原因", "如何预防")):
        return "hypothetical"
    if any(term in text for term in ("不疼", "不痛", "没有腹痛", "无腹痛", "否认腹痛")):
        return "negated"
    if any(term in text for term in ("缓解", "好了", "不疼了", "不痛了", "恢复正常", "消失")):
        return "resolved"
    if any(term in text for term in ("以前", "之前", "曾经", "去年", "小时候", "多年前")):
        return "historical"
    return "current"


def main() -> None:
    st.set_page_config(page_title="腹痛5条最终盲裁", layout="wide")
    st.title("腹痛补充5条最终盲裁")
    st.caption("全部完成前不读取旧标签或规则预测；不显示医生回答。")
    if sha256(SOURCE) != SOURCE_HASH:
        st.error("补充8条源文件哈希不匹配，已停止。")
        st.stop()
    shared = load_shared_review_tool()
    fieldnames, rows = shared.load_csv(QUEUE)
    if len(rows) != 5 or len({row["review_id"] for row in rows}) != 5 or any("answer" in field.lower() or field.startswith("human_") for field in fieldnames):
        st.error("盲裁队列结构不合法，已停止。")
        st.stop()
    pending = [row for row in rows if not complete(row)]
    st.progress((5 - len(pending)) / 5, text=f"最终盲裁进度：{5 - len(pending)} / 5")
    if not pending:
        st.success("5条最终盲裁已完成。现在才加载并展示旧标签与规则草案结果。")
        with SOURCE.open("r", encoding="utf-8-sig", newline="") as stream:
            old_by_id = {row["review_id"]: row for row in csv.DictReader(stream)}
        for row in rows:
            old = old_by_id[row["review_id"]]
            with st.expander(row["review_id"]):
                st.json({
                    "旧标签": {
                        "candidate_current": old["human_candidate_current"],
                        "candidate_status": old["human_candidate_status"],
                        "complaints": old["human_candidate_complaints"],
                        "intent": old["human_candidate_intent"],
                        "risk_present": old["human_risk_present"],
                        "risk_scope": old["human_risk_scope"],
                        "risk_category": old["human_risk_category"],
                    },
                    "规则草案状态": rule_status(row),
                    "最终裁决": {field: row[field] for field in FINAL_FIELDS},
                })
        st.stop()
    selected = st.selectbox("待裁决 review_id", [row["review_id"] for row in pending], key="followup_adjudication_id")
    row = next(item for item in pending if item["review_id"] == selected)
    left, right = st.columns(2)
    left.info(row["title"] or "（空）")
    right.warning(row["ask"] or "（空）")
    current = select_with_blank("最终候选当前性", CURRENT_OPTIONS, row["final_candidate_current"], widget_key(selected, "adjudication_current"))
    status = select_with_blank("最终候选状态", STATUS_OPTIONS, row["final_candidate_status"], widget_key(selected, "adjudication_status"))
    complaints = st.multiselect("最终主诉", list(shared.COMPLAINT_OPTIONS), default=[item for item in row["final_complaints"].split("|") if item], key=widget_key(selected, "adjudication_complaints"))
    intent = select_with_blank("最终意图", tuple(shared.INTENT_OPTIONS), row["final_intent"], widget_key(selected, "adjudication_intent"))
    risk_present = select_with_blank("最终风险存在性", RISK_PRESENT_OPTIONS, row["final_risk_present"], widget_key(selected, "adjudication_risk_present"))
    risk_scope = select_with_blank("最终风险scope", RISK_SCOPE_OPTIONS, row["final_risk_scope"], widget_key(selected, "adjudication_risk_scope"))
    risk_category = select_with_blank("最终风险类别", RISK_CATEGORY_OPTIONS, row["final_risk_category"], widget_key(selected, "adjudication_risk_category"))
    reason = select_with_blank("裁决理由", REASON_OPTIONS, row["adjudication_reason"], widget_key(selected, "adjudication_reason"))
    notes = st.text_area("最终备注", value=row["final_notes"], key=widget_key(selected, "adjudication_notes"))
    if st.button("保存最终裁决", type="primary", use_container_width=True):
        if not all([current, status, complaints, intent, risk_present, risk_scope, risk_category, reason]):
            st.error("请填写全部最终裁决字段。")
            return
        error = validate_semantics({
            "final_candidate_current": current, "final_candidate_status": status,
            "final_risk_present": risk_present, "final_risk_scope": risk_scope,
            "final_risk_category": risk_category, "final_notes": notes,
        }, "final_")
        if error:
            st.error(error)
            return
        with shared.SAVE_LOCK:
            current_fields, current_rows = shared.load_csv(QUEUE)
            index = {item["review_id"]: offset for offset, item in enumerate(current_rows)}[selected]
            updated = dict(current_rows[index])
            updated.update({
                "final_candidate_current": current, "final_candidate_status": status,
                "final_complaints": shared.normalize_multi_labels(complaints), "final_intent": intent,
                "final_risk_present": risk_present, "final_risk_scope": risk_scope,
                "final_risk_category": risk_category, "adjudication_reason": reason,
                "final_notes": notes.strip(),
            })
            current_rows[index] = updated
            shared.create_backup(QUEUE, BACKUPS, keep=10)
            shared.atomic_write_csv(QUEUE, current_fields, current_rows)
        st.rerun()


if __name__ == "__main__":
    main()
