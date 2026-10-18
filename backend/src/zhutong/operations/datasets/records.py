"""监测记录：手工录入、修订与试算；记录、判定、事件、通知、审计、回执同事务。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Device, Point
from ...db.models.monitoring import Baseline, MonitoringRule, MonitorRecord
from ...domain.monitoring.engine import assess_record, parse_iso
from ...domain.monitoring.rules import baseline_at_time, rule_for_point, snapshot_of
from ...domain.monitoring.validation import check_reading, now_iso
from ..identity_types import ROLES
from .alarms import apply_assessment
from .core.helpers import get_row
from .core.serialize import baseline_out, device_out, point_out, record_out, rule_out
from .core.workspace import (
    RECORD_ROLES,
    Workspace,
    bump,
    day_key,
    next_number,
    require_revision,
    require_role,
    uid,
    write_audit,
)


def _rules(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(MonitoringRule).where(MonitoringRule.dataset_id == workspace.dataset_id)
    )
    return [rule_out(row) for row in rows]


def _baselines(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(select(Baseline).where(Baseline.dataset_id == workspace.dataset_id))
    return [baseline_out(row) for row in rows]


def _records_of_point(session: Session, workspace: Workspace, point_id: str) -> list[MonitorRecord]:
    return list(
        session.scalars(
            select(MonitorRecord)
            .where(
                MonitorRecord.dataset_id == workspace.dataset_id,
                MonitorRecord.point_id == point_id,
            )
            .order_by(MonitorRecord.sample_time.asc())
        )
    )


def _device_for(
    session: Session, workspace: Workspace, point_id: str, device_id: str | None
) -> dict | None:
    if device_id is not None:
        row = get_row(session, Device, workspace.dataset_id, device_id, "设备")
        if row.point_id != point_id:
            raise AppError("DEVICE_POINT_MISMATCH", "所选设备不属于该测点", 422)
        if row.status != "active":
            raise AppError("STATE_CONFLICT", "设备已归档，不能再用于新记录", 409)
        return device_out(row)
    row = session.scalar(
        select(Device)
        .where(
            Device.dataset_id == workspace.dataset_id,
            Device.point_id == point_id,
            Device.status == "active",
        )
        .order_by(Device.created_at.asc())
        .limit(1)
    )
    return device_out(row) if row is not None else None


def _current(point: dict, payload: dict, baseline: dict | None) -> dict:
    return {
        "id": "preview",
        "recordNo": "预览",
        "pointId": point["id"],
        "metric": point["metric"],
        "values": payload["values"],
        "unit": payload["unit"],
        "sampleTime": payload["sampleTime"],
        "sampleWindow": payload.get("sampleWindow", ""),
        "quality": payload["quality"],
        "baselineValues": baseline["values"] if baseline is not None else None,
    }


def _assess(
    session: Session,
    workspace: Workspace,
    point: Point,
    payload: dict,
    exclude_record_id: str | None,
) -> dict:
    point_data = point_out(point)
    rules = _rules(session, workspace)
    rule = rule_for_point(rules, point_data, payload["sampleTime"])
    baseline = baseline_at_time(_baselines(session, workspace), point.id, payload["sampleTime"])
    stored = [
        record_out(row)
        for row in _records_of_point(session, workspace, point.id)
        if row.id != exclude_record_id and row.sample_time <= payload["sampleTime"]
    ]
    history = [*stored, _current(point_data, payload, baseline)]
    if rule is None:
        return {
            "rule": None,
            "snapshot": None,
            "baseline": baseline,
            "assessment": None,
            "history": history,
            "input": None,
        }
    device = _device_for(session, workspace, point.id, payload.get("deviceId"))
    engine_input = {
        "rule": rule,
        "point": point_data,
        "values": payload["values"],
        "baselineValues": baseline["values"] if baseline is not None else None,
        "quality": payload["quality"],
        "device": device,
        "history": history,
        "at": payload["sampleTime"],
    }
    return {
        "rule": rule,
        "snapshot": snapshot_of(rule),
        "baseline": baseline,
        "assessment": assess_record(engine_input),
        "history": history,
        "input": engine_input,
    }


def _validate(
    session: Session,
    workspace: Workspace,
    point: Point,
    payload: dict,
    exclude_record_id: str | None,
) -> dict:
    existing = [record_out(row) for row in _records_of_point(session, workspace, point.id)]
    check = check_reading(
        {
            "pointId": point.id,
            "metric": point.metric,
            "values": payload["values"],
            "unit": payload["unit"],
            "sampleTime": payload["sampleTime"],
            "sampleWindow": payload.get("sampleWindow", ""),
            "quality": payload["quality"],
            "qualityNote": payload.get("qualityNote", ""),
            "note": payload.get("note", ""),
            "excludeRecordId": exclude_record_id,
            "device": _device_for(session, workspace, point.id, payload.get("deviceId")),
            "enteredAt": now_iso(),
        },
        existing,
    )
    if check["issues"]:
        raise AppError(
            "VALIDATION_FAILED",
            "记录校验未通过",
            422,
            {"fields": check["issues"]},
        )
    return check


def _point_for_record(session: Session, workspace: Workspace, point_id: str) -> Point:
    point = get_row(session, Point, workspace.dataset_id, point_id, "测点")
    if point.status != "active":
        raise AppError("STATE_CONFLICT", "测点已归档，不能录入新记录", 409)
    return point


def preview_assessment(session: Session, workspace: Workspace, payload: dict) -> dict:
    point = _point_for_record(session, workspace, payload["pointId"])
    outcome = _assess(session, workspace, point, payload, payload.get("recordId"))
    return {
        "rule": outcome["rule"],
        "snapshot": outcome["snapshot"],
        "baseline": outcome["baseline"],
        "assessment": outcome["assessment"],
        "historyCount": len(outcome["history"]) - 1,
    }


def _record_no(session: Session, workspace: Workspace, sample_time: str) -> str:
    return next_number(
        session,
        MonitorRecord,
        MonitorRecord.record_no,
        workspace.dataset_id,
        f"R{day_key(sample_time)}-",
    )


def _new_record(
    session: Session, workspace: Workspace, point: Point, payload: dict, check: dict, outcome: dict
) -> MonitorRecord:
    at = now_iso()
    baseline = outcome["baseline"]
    assessment = outcome["assessment"]
    snapshot = outcome["snapshot"]
    row = MonitorRecord(
        dataset_id=workspace.dataset_id,
        id=uid("rec"),
        record_no=_record_no(session, workspace, payload["sampleTime"]),
        point_id=point.id,
        device_id=payload.get("deviceId"),
        metric=point.metric,
        values=payload["values"],
        unit=payload["unit"],
        sample_time=payload["sampleTime"],
        sample_window=payload.get("sampleWindow", ""),
        entered_at=at,
        entered_by=workspace.actor.name,
        entered_by_role=ROLES.get(workspace.actor.role, workspace.actor.role),
        source=payload.get("source", "manual"),
        quality=payload["quality"],
        quality_note=payload.get("qualityNote", ""),
        note=payload.get("note", ""),
        is_backfill=check["backfill"],
        baseline_version=baseline["version"] if baseline is not None else None,
        baseline_values=baseline["values"] if baseline is not None else None,
        revisions=[],
        created_at=at,
        record_revision=0,
        rule_id=snapshot["ruleId"] if snapshot is not None else None,
        rule_version=snapshot["ruleVersion"] if snapshot is not None else None,
        rule_snapshot=snapshot,
        assessment=assessment,
    )
    session.add(row)
    session.flush()
    return row


def _audit_record(
    session: Session,
    workspace: Workspace,
    row: MonitorRecord,
    point: Point,
    action: str,
    summary: str,
    reason: str,
) -> None:
    write_audit(
        session,
        workspace,
        action=action,
        object_type="record",
        object_id=row.id,
        object_label=f"{row.record_no} {point.code} {point.name}",
        summary=summary,
        reason=reason,
    )


def create_record(session: Session, workspace: Workspace, payload: dict) -> dict:
    require_role(workspace, RECORD_ROLES, "监测记录录入")
    if payload.get("source", "manual") not in {"manual", "device", "csv"}:
        raise AppError("VALIDATION_FAILED", "记录来源无效", 422)
    point = _point_for_record(session, workspace, payload["pointId"])
    check = _validate(session, workspace, point, payload, None)
    payload = {**payload, "quality": "invalid" if check["outOfRange"] else payload["quality"]}
    outcome = _assess(session, workspace, point, payload, None)
    row = _new_record(session, workspace, point, payload, check, outcome)
    _audit_record(
        session,
        workspace,
        row,
        point,
        "create",
        f"录入监测记录 {row.record_no}",
        payload.get("note", ""),
    )
    if outcome["snapshot"] is not None:
        event = apply_assessment(
            session, workspace, row, outcome["assessment"], outcome["snapshot"]
        )
    else:
        event = {
            "action": "none",
            "eventId": "",
            "eventNo": "",
            "message": "该点位没有适用的启用规则，未生成预警事件",
        }
    return {"record": record_out(row), "assessment": outcome["assessment"], "event": event}


def revise_record(
    session: Session,
    workspace: Workspace,
    record_id: str,
    payload: dict,
    expected_rev: int | None,
    reason: str,
) -> dict:
    require_role(workspace, RECORD_ROLES, "监测记录修订")
    if reason.strip() == "":
        raise AppError("REASON_REQUIRED", "修订必须填写原因", 422)
    row = get_row(session, MonitorRecord, workspace.dataset_id, record_id, "监测记录")
    require_revision(expected_rev, row)
    point = _point_for_record(session, workspace, row.point_id)
    check = _validate(session, workspace, point, payload, row.id)
    payload = {**payload, "quality": "invalid" if check["outOfRange"] else payload["quality"]}
    outcome = _assess(session, workspace, point, payload, row.id)
    baseline = outcome["baseline"]
    snapshot = outcome["snapshot"]
    at = now_iso()
    before = {
        "values": row.values,
        "unit": row.unit,
        "sampleTime": row.sample_time,
        "quality": row.quality,
        "sampleWindow": row.sample_window,
        "baselineVersion": row.baseline_version,
        "baselineValues": row.baseline_values,
    }
    row.values = payload["values"]
    row.unit = payload["unit"]
    row.sample_time = payload["sampleTime"]
    row.sample_window = payload.get("sampleWindow", "")
    row.source = payload.get("source", row.source)
    row.quality = payload["quality"]
    row.quality_note = payload.get("qualityNote", "")
    row.note = payload.get("note", "")
    row.device_id = payload.get("deviceId", row.device_id)
    row.is_backfill = check["backfill"]
    row.baseline_version = baseline["version"] if baseline is not None else None
    row.baseline_values = baseline["values"] if baseline is not None else None
    row.revisions = [
        *(row.revisions or []),
        {
            "at": at,
            "by": workspace.actor.name,
            "role": ROLES.get(workspace.actor.role, workspace.actor.role),
            "reason": reason.strip(),
            "before": before,
        },
    ]
    row.record_revision += 1
    row.rule_id = snapshot["ruleId"] if snapshot is not None else None
    row.rule_version = snapshot["ruleVersion"] if snapshot is not None else None
    row.rule_snapshot = snapshot
    row.assessment = outcome["assessment"]
    bump(row, workspace, at)
    _audit_record(
        session,
        workspace,
        row,
        point,
        "revise",
        f"修订监测记录 {row.record_no}（第 {row.record_revision} 次）",
        reason.strip(),
    )
    if snapshot is not None:
        event = apply_assessment(
            session,
            workspace,
            row,
            outcome["assessment"],
            snapshot,
            revision_reason=reason.strip(),
        )
    else:
        event = {
            "action": "none",
            "eventId": "",
            "eventNo": "",
            "message": "该点位没有适用的启用规则，未生成预警事件",
        }
    return {"record": record_out(row), "assessment": outcome["assessment"], "event": event}


def list_records(
    session: Session, workspace: Workspace, point_id: str | None = None, limit: int = 2000
) -> list[dict]:
    query = select(MonitorRecord).where(MonitorRecord.dataset_id == workspace.dataset_id)
    if point_id:
        query = query.where(MonitorRecord.point_id == point_id)
    rows = session.scalars(
        query.order_by(MonitorRecord.sample_time.asc()).limit(max(1, min(limit, 5000)))
    )
    return [record_out(row) for row in rows]


def history_for(session: Session, workspace: Workspace, point_id: str, at: str) -> list[dict]:
    return [
        record_out(row)
        for row in _records_of_point(session, workspace, point_id)
        if parse_iso(row.sample_time) is not None and row.sample_time <= at
    ]


def point_rows(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(select(Point).where(Point.dataset_id == workspace.dataset_id))
    return [point_out(row) for row in rows]


def rule_rows(session: Session, workspace: Workspace) -> list[dict]:
    return _rules(session, workspace)


def baseline_rows(session: Session, workspace: Workspace) -> list[dict]:
    return _baselines(session, workspace)


def all_record_rows(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(MonitorRecord).where(MonitorRecord.dataset_id == workspace.dataset_id)
    )
    return [record_out(row) for row in rows]


def context_for_import(session: Session, workspace: Workspace) -> dict[str, Any]:
    return {
        "points": point_rows(session, workspace),
        "rules": rule_rows(session, workspace),
        "baselines": baseline_rows(session, workspace),
        "existing": all_record_rows(session, workspace),
    }
