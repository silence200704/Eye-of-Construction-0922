"""CSV 预检与整批原子提交：预览和确认之间重读规则、档案与版本。"""

import hashlib
import json

from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...domain.monitoring.csv import build_preview, stale_marker, valid_payloads
from ...domain.monitoring.validation import now_iso
from .core.workspace import Workspace, write_audit
from .records import context_for_import, create_record


def _digest(text: str, workspace: Workspace, context: dict) -> str:
    payload = {
        "text": text,
        "epoch": workspace.epoch,
        "state": stale_marker(context),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _preview(session: Session, workspace: Workspace, text: str) -> tuple[dict, str]:
    context = context_for_import(session, workspace)
    preview = build_preview(text, {**context, "enteredAt": now_iso()})
    return preview, _digest(text, workspace, context)


def preview_import(session: Session, workspace: Workspace, text: str) -> dict:
    preview, token = _preview(session, workspace, text)
    return {**preview, "token": token}


def _selected_rows(preview: dict, line_nos: list[int] | None) -> list[dict]:
    if line_nos is None:
        return valid_payloads(preview)
    by_line = {row["lineNo"]: row for row in preview["rows"]}
    selected: list[dict] = []
    invalid: list[int] = []
    for line_no in line_nos:
        row = by_line.get(line_no)
        if row is None or row["payload"] is None:
            invalid.append(line_no)
            continue
        selected.append(row["payload"])
    if invalid:
        raise AppError(
            "INVALID_ROWS",
            "选中的行在最新预检中不可导入，请重新预览",
            422,
            {"lineNos": invalid},
        )
    return selected


def _summary(records: list[dict]) -> tuple[list[str], list[dict]]:
    messages: list[str] = []
    events: list[dict] = []
    seen: set[str] = set()
    for item in records:
        event = item["event"]
        if event["eventId"] == "" or event["eventId"] in seen:
            continue
        seen.add(event["eventId"])
        if event["message"] != "" and event["message"] not in messages:
            messages.append(event["message"])
        events.append(
            {
                "action": event["action"],
                "eventId": event["eventId"],
                "eventNo": event["eventNo"],
                "message": event["message"],
                "pointId": item["record"]["pointId"],
            }
        )
    return messages, events


def commit_import(session: Session, workspace: Workspace, payload: dict) -> dict:
    text = payload.get("csvText", "")
    if not isinstance(text, str) or text.strip() == "":
        raise AppError("VALIDATION_FAILED", "CSV 内容不能为空", 422)
    preview, token = _preview(session, workspace, text)
    if payload.get("token") != token:
        raise AppError(
            "PREVIEW_STALE",
            "预览后档案、规则或记录已变化，请重新预览再提交",
            409,
            {"token": token, "preview": preview},
        )
    selected = _selected_rows(preview, payload.get("lineNos"))
    if not selected:
        raise AppError("INVALID_ROWS", "没有可提交的有效行", 422)
    created: list[dict] = []
    for item in selected:
        created.append(
            create_record(
                session,
                workspace,
                {
                    **item,
                    "deviceId": None,
                    "qualityNote": "",
                    "source": "csv",
                },
            )
        )
    messages, events = _summary(created)
    write_audit(
        session,
        workspace,
        action="import",
        object_type="record",
        object_id="csv",
        object_label=f"CSV 批量导入（{payload.get('fileName', '粘贴文本')}）",
        summary=f"CSV 批量导入：写入 {len(created)} 条，跳过错误行 {preview['errorCount']} 条",
        reason=(
            f"来源文件：{payload.get('fileName', '粘贴文本')}；"
            "错误行只在预览中提示，不写入正式数据；"
            "整批原子提交，与手工录入共用判定链路"
        ),
    )
    return {
        "imported": len(created),
        "skipped": preview["errorCount"],
        "eventMessages": messages,
        "events": events,
        "records": [item["record"]["id"] for item in created],
    }
