#!/usr/bin/env python3
"""腹痛7条盲审二次裁决入口；第一阶段绝不展示第一轮人工标签。"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path
from typing import Any

import streamlit as st

TOOLS_DIR = Path(__file__).resolve().parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))
from abdominal_review_mode import load_shared_review_tool  # noqa: E402


PROJECT_ROOT = Path(__file__).resolve().parents[1]
FIRST_ROUND_CSV = PROJECT_ROOT / "reports" / "abdominal-pain-targeted-review.csv"
ADJUDICATION_CSV = PROJECT_ROOT / "reports" / "abdominal-pain-targeted-adjudication.csv"
BACKUP_DIR = PROJECT_ROOT / "reports" / "abdominal-pain-adjudication-backups"
FIRST_ROUND_SHA256 = "3c0a677b3b18806113ef7d4fcab3b121b3dddd03aaf1df0f03016c4a928acf80"
REVIEW_IDS = (
    "ABD-TARGET-001", "ABD-TARGET-002", "ABD-TARGET-007", "ABD-TARGET-008",
    "ABD-TARGET-011", "ABD-TARGET-012", "ABD-TARGET-016",
)

CURRENT_OPTIONS = ("yes", "no", "uncertain")
STATUS_OPTIONS = ("current", "resolved", "historical", "negated", "hypothetical", "uncertain")
RISK_PRESENT_OPTIONS = ("yes", "no", "uncertain")
RISK_SCOPE_OPTIONS = ("abdominal_specific", "global_other", "uncertain", "none")
RISK_CATEGORY_OPTIONS = (
    "sudden_severe_abdominal_pain", "hematemesis", "hematochezia_or_melena",
    "distension_no_stool_or_gas", "syncope_or_altered_consciousness",
    "severe_breathing_difficulty", "hemoptysis", "hematuria", "other", "none",
)
ABDOMINAL_RISK_CATEGORIES = {
    "sudden_severe_abdominal_pain", "hematemesis", "hematochezia_or_melena",
    "distension_no_stool_or_gas", "syncope_or_altered_consciousness",
    "severe_breathing_difficulty",
}
GLOBAL_RISK_CATEGORIES = {"hemoptysis", "hematuria", "other"}
REASON_OPTIONS = (
    "label_definition_updated", "first_round_ambiguous_field", "second_round_corrected",
    "text_ambiguity", "risk_scope_reclassified", "other",
)
SECOND_FIELDS = (
    "human_candidate_current", "human_candidate_status", "human_candidate_complaints",
    "human_candidate_intent", "human_risk_present", "human_risk_scope",
    "human_risk_category",
)
FINAL_FIELDS = (
    "final_candidate_current", "final_candidate_status", "final_complaints", "final_intent",
    "final_risk_present", "final_risk_scope", "final_risk_category", "final_reason_category",
)


def sha256_file(path: Path) -> str:
    """流式计算文件哈希，避免改变源文件。"""

    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_rows(fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    """确保只加载固定7条盲审队列，且无第一轮标签和医生回答。"""

    required = {
        "review_id", "source_row_id", "title", "ask", "candidate_complaint",
        *SECOND_FIELDS, "human_adjudication_notes", *FINAL_FIELDS, "final_notes",
    }
    missing = required - set(fieldnames)
    if missing:
        raise ValueError(f"二次裁决文件缺少字段：{sorted(missing)}")
    forbidden = {"answer", "doctor_answer", "sampling_reason", "human_current_symptom"} & set(fieldnames)
    if forbidden:
        raise ValueError(f"盲审文件含禁止字段：{sorted(forbidden)}")
    if len(rows) != 7 or tuple(row["review_id"] for row in rows) != REVIEW_IDS:
        raise ValueError("二次裁决文件必须只包含固定7个review_id并保持顺序")
    if any(row["candidate_complaint"] != "abdominal_pain" for row in rows):
        raise ValueError("二次裁决入口仅支持abdominal_pain")


def second_complete(row: dict[str, str]) -> bool:
    return all((row.get(field) or "").strip() for field in SECOND_FIELDS)


def final_complete(row: dict[str, str]) -> bool:
    return all((row.get(field) or "").strip() for field in FINAL_FIELDS)


def validate_semantics(values: dict[str, Any], prefix: str) -> str | None:
    """固定校验当前性与状态、风险存在性与scope/category的一致性。"""

    current = values[f"{prefix}candidate_current"]
    status = values[f"{prefix}candidate_status"]
    risk_present = values[f"{prefix}risk_present"]
    risk_scope = values[f"{prefix}risk_scope"]
    risk_category = values[f"{prefix}risk_category"]
    notes = values[f"{prefix}notes"]

    if current == "yes" and status != "current":
        return "候选腹痛为当前yes时，status必须为current。"
    if current == "no" and status not in {"resolved", "historical", "negated", "hypothetical"}:
        return "候选腹痛为no时，status必须说明resolved/historical/negated/hypothetical。"
    if current == "uncertain" and status != "uncertain":
        return "候选腹痛为uncertain时，status必须为uncertain。"
    if risk_present == "no" and (risk_scope != "none" or risk_category != "none"):
        return "无风险表达时，risk_scope和risk_category都必须为none。"
    if risk_present == "yes" and (risk_scope == "none" or risk_category == "none"):
        return "存在风险表达时，必须选择具体scope和category。"
    if risk_present == "uncertain" and (risk_scope == "none" or risk_category == "none"):
        return "风险不确定时不能选择none；请用uncertain scope和other category并说明原因。"
    if risk_scope == "abdominal_specific" and risk_category not in ABDOMINAL_RISK_CATEGORIES:
        return "abdominal_specific只能选择冻结腹痛风险类别。"
    if risk_scope == "global_other" and risk_category not in GLOBAL_RISK_CATEGORIES:
        return "global_other只能选择hemoptysis、hematuria或other。"
    if (current == "uncertain" or status == "uncertain" or risk_present == "uncertain" or risk_scope == "uncertain" or risk_category == "other") and not notes.strip():
        return "选择uncertain或other时必须在备注中写明语言歧义原因。"
    return None


def save_row(shared: Any, review_id: str, updates: dict[str, str]) -> None:
    """按review_id即时保存；写入前备份，最多保留10份。"""

    with shared.SAVE_LOCK:
        fieldnames, rows = shared.load_csv(ADJUDICATION_CSV)
        validate_rows(fieldnames, rows)
        by_id = {row["review_id"]: index for index, row in enumerate(rows)}
        if review_id not in by_id:
            raise KeyError(review_id)
        updated = dict(rows[by_id[review_id]])
        updated.update(updates)
        rows[by_id[review_id]] = updated
        shared.create_backup(ADJUDICATION_CSV, BACKUP_DIR, keep=10)
        shared.atomic_write_csv(ADJUDICATION_CSV, fieldnames, rows)


def render_text(row: dict[str, str]) -> None:
    title_col, ask_col = st.columns(2)
    with title_col:
        st.markdown("#### 患者侧 title")
        st.info(row["title"] or "（空）")
    with ask_col:
        st.markdown("#### 患者侧 ask")
        st.warning(row["ask"] or "（空）")


def select_with_blank(label: str, options: tuple[str, ...], value: str, key: str) -> str:
    choices = [""] + list(options)
    return st.selectbox(label, choices, index=choices.index(value) if value in choices else 0, key=key)


def render_blind_review(shared: Any, rows: list[dict[str, str]]) -> None:
    completed = sum(second_complete(row) for row in rows)
    st.caption("盲审阶段：第一轮标签、抽样分层和预测结果均隐藏。7条全部完成后才解锁两轮对比。")
    st.progress(completed / 7, text=f"二次盲审进度：{completed} / 7")
    pending = [row for row in rows if not second_complete(row)]
    visible = pending or rows
    ids = [row["review_id"] for row in visible]
    selected_id = st.selectbox("review_id", ids, key="blind_review_id")
    row = next(item for item in visible if item["review_id"] == selected_id)
    render_text(row)

    current = select_with_blank("候选腹痛是否属于当前或近期本次腹痛", CURRENT_OPTIONS, row["human_candidate_current"], "second_current")
    status = select_with_blank("候选腹痛发生状态", STATUS_OPTIONS, row["human_candidate_status"], "second_status")
    complaints = st.multiselect("最终症状主诉（可多选）", list(shared.COMPLAINT_OPTIONS), default=[value for value in row["human_candidate_complaints"].split("|") if value], key="second_complaints")
    intent = select_with_blank("咨询意图", tuple(shared.INTENT_OPTIONS), row["human_candidate_intent"], "second_intent")
    risk_present = select_with_blank("是否存在需要风险引擎关注的明确语言表达", RISK_PRESENT_OPTIONS, row["human_risk_present"], "second_risk_present")
    risk_scope = select_with_blank("风险scope", RISK_SCOPE_OPTIONS, row["human_risk_scope"], "second_risk_scope")
    risk_category = select_with_blank("风险类别", RISK_CATEGORY_OPTIONS, row["human_risk_category"], "second_risk_category")
    notes = st.text_area("二次裁决备注（uncertain/other时必填）", value=row["human_adjudication_notes"], key="second_notes")

    if st.button("保存二次盲审", type="primary", use_container_width=True):
        if not all([current, status, complaints, intent, risk_present, risk_scope, risk_category]):
            st.error("请填写全部二次裁决字段。")
            return
        values = {
            "human_candidate_current": current,
            "human_candidate_status": status,
            "human_candidate_complaints": shared.normalize_multi_labels(complaints),
            "human_candidate_intent": intent,
            "human_risk_present": risk_present,
            "human_risk_scope": risk_scope,
            "human_risk_category": risk_category,
            "human_adjudication_notes": notes.strip(),
        }
        error = validate_semantics({
            "human_candidate_current": current, "human_candidate_status": status,
            "human_risk_present": risk_present, "human_risk_scope": risk_scope,
            "human_risk_category": risk_category, "human_notes": notes,
        }, "human_")
        if error:
            st.error(error)
            return
        save_row(shared, row["review_id"], values)
        st.rerun()


def render_final_adjudication(shared: Any, rows: list[dict[str, str]], first_rows: list[dict[str, str]]) -> None:
    completed = sum(final_complete(row) for row in rows)
    st.success("7条二次盲审已完成，现在可以查看第一轮并进行最终裁决。")
    st.progress(completed / 7, text=f"最终裁决进度：{completed} / 7")
    first_by_id = {row["review_id"]: row for row in first_rows}
    ids = [row["review_id"] for row in rows]
    selected_id = st.selectbox("review_id", ids, key="final_review_id")
    row = next(item for item in rows if item["review_id"] == selected_id)
    first = first_by_id[selected_id]
    render_text(row)

    left, right = st.columns(2)
    with left:
        st.markdown("#### 第一轮（旧口径）")
        st.json({
            "legacy_current_symptom": first["human_current_symptom"],
            "complaints": first["human_final_complaint"],
            "intent": first["human_intent"],
            "legacy_risk_expression": first["human_risk_expression"],
        })
    with right:
        st.markdown("#### 第二轮（V2口径）")
        st.json({field: row[field] for field in SECOND_FIELDS})

    current = select_with_blank("最终候选当前性", CURRENT_OPTIONS, row["final_candidate_current"], "final_current")
    status = select_with_blank("最终候选状态", STATUS_OPTIONS, row["final_candidate_status"], "final_status")
    complaints = st.multiselect("最终主诉（可多选）", list(shared.COMPLAINT_OPTIONS), default=[value for value in row["final_complaints"].split("|") if value], key="final_complaints")
    intent = select_with_blank("最终意图", tuple(shared.INTENT_OPTIONS), row["final_intent"], "final_intent")
    risk_present = select_with_blank("最终风险存在性", RISK_PRESENT_OPTIONS, row["final_risk_present"], "final_risk_present")
    risk_scope = select_with_blank("最终风险scope", RISK_SCOPE_OPTIONS, row["final_risk_scope"], "final_risk_scope")
    risk_category = select_with_blank("最终风险类别", RISK_CATEGORY_OPTIONS, row["final_risk_category"], "final_risk_category")
    reason = select_with_blank("裁决理由类别", REASON_OPTIONS, row["final_reason_category"], "final_reason")
    notes = st.text_area("最终备注（可空；uncertain/other时必填）", value=row["final_notes"], key="final_notes")

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
        if reason == "other" and not notes.strip():
            st.error("裁决理由为other时必须填写备注。")
            return
        save_row(shared, row["review_id"], {
            "final_candidate_current": current,
            "final_candidate_status": status,
            "final_complaints": shared.normalize_multi_labels(complaints),
            "final_intent": intent,
            "final_risk_present": risk_present,
            "final_risk_scope": risk_scope,
            "final_risk_category": risk_category,
            "final_reason_category": reason,
            "final_notes": notes.strip(),
        })
        st.rerun()


def main() -> None:
    st.set_page_config(page_title="腹痛7条盲审二次裁决", layout="wide")
    st.title("腹痛7条定向二次裁决")
    st.caption("仅进行语言标签裁决；不显示医生回答，不生成诊断、药物或治疗建议。")
    try:
        if sha256_file(FIRST_ROUND_CSV) != FIRST_ROUND_SHA256:
            raise ValueError("第一轮CSV哈希不匹配，已停止以防误覆盖")
        shared = load_shared_review_tool()
        fieldnames, rows = shared.load_csv(ADJUDICATION_CSV)
        validate_rows(fieldnames, rows)
    except Exception as error:
        st.error(f"二次裁决工具无法启动：{error}")
        st.stop()

    if all(second_complete(row) for row in rows):
        # 只有二次盲审全部完成后才读取第一轮标签，进一步降低确认偏差。
        _, first_rows = shared.load_csv(FIRST_ROUND_CSV)
        render_final_adjudication(shared, rows, first_rows)
    else:
        render_blind_review(shared, rows)


if __name__ == "__main__":
    main()
