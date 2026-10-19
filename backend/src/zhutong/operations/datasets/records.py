"""监测记录：手工录入、修订与试算；记录、判定、事件、通知、审计、回执同事务。"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Device, Point
from ...db.models.monitoring import MonitorRecord
from ...domain.monitoring.engine import assess_record
from ...domain.monitoring.rules import baseline_at_time, rule_for_point, snapshot_of
from ...domain.monitoring.validation import check_reading, now_iso
from ..identity_types import ROLES
from .alarms import AssessmentCommand, apply_assessment
from .core.helpers import get_row
from .core.record_queries import (
    baselines_for_dataset,
    records_of_point,
    rules_for_dataset,
)
from .core.serialize import device_out, point_out, record_out
from .core.workspace import (
    RECORD_ROLES,
    AuditEntry,
    Workspace,
    bump,
    day_key,
    next_number,
    require_building,
    require_revision,
    require_role,
    uid,
    write_audit,
)


@dataclass(frozen=True)
class RecordSeed:
    point: Point
    payload: dict
    check: dict
    outcome: dict


@dataclass(frozen=True)
class RevisionCommand:
    record_id: str
    payload: dict
    expected_rev: int | None
    reason: str


@dataclass(frozen=True)
class RevisionUpdate:
    payload: dict
    check: dict
    baseline: dict | None
    snapshot: dict | None
    assessment: dict | None
    at: str
    reason: str


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
    rule = rule_for_point(rules_for_dataset(session, workspace), point_data, payload["sampleTime"])
    baseline = baseline_at_time(
        baselines_for_dataset(session, workspace), point.id, payload["sampleTime"]
    )
    stored = [
        record_out(row)
        for row in records_of_point(session, workspace, point.id)
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
    }


def _validate(
    session: Session,
    workspace: Workspace,
    point: Point,
    payload: dict,
    exclude_record_id: str | None,
) -> dict:
    existing = [record_out(row) for row in records_of_point(session, workspace, point.id)]
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
    # 记录、修订、试算与 CSV 提交共用此入口：范围校验不能只放在页面上。
    require_building(workspace, point.building_id)
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


def _new_record(session: Session, workspace: Workspace, seed: RecordSeed) -> MonitorRecord:
    at = now_iso()
    payload = seed.payload
    baseline = seed.outcome["baseline"]
    snapshot = seed.outcome["snapshot"]
    row = MonitorRecord(
        dataset_id=workspace.dataset_id,
        id=uid("rec"),
        record_no=_record_no(session, workspace, payload["sampleTime"]),
        point_id=seed.point.id,
        device_id=payload.get("deviceId"),
        metric=seed.point.metric,
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
        is_backfill=seed.check["backfill"],
        baseline_version=baseline["version"] if baseline is not None else None,
        baseline_values=baseline["values"] if baseline is not None else None,
        revisions=[],
        created_at=at,
        record_revision=0,
        rule_id=snapshot["ruleId"] if snapshot is not None else None,
        rule_version=snapshot["ruleVersion"] if snapshot is not None else None,
        rule_snapshot=snapshot,
        assessment=seed.outcome["assessment"],
    )
    session.add(row)
    session.flush()
    return row


def create_record(session: Session, workspace: Workspace, payload: dict) -> dict:
    require_role(workspace, RECORD_ROLES, "监测记录录入")
    if payload.get("source", "manual") not in {"manual", "device", "csv"}:
        raise AppError("VALIDATION_FAILED", "记录来源无效", 422)
    point = _point_for_record(session, workspace, payload["pointId"])
    check = _validate(session, workspace, point, payload, None)
    normalized = {**payload, "quality": "invalid" if check["outOfRange"] else payload["quality"]}
    outcome = _assess(session, workspace, point, normalized, None)
    row = _new_record(
        session,
        workspace,
        RecordSeed(point=point, payload=normalized, check=check, outcome=outcome),
    )
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="create",
            object_type="record",
            object_id=row.id,
            object_label=f"{row.record_no} {point.code} {point.name}",
            summary=f"录入监测记录 {row.record_no}",
            reason=normalized.get("note", ""),
        ),
    )
    if outcome["snapshot"] is not None:
        event = apply_assessment(
            session,
            workspace,
            AssessmentCommand(
                record=row,
                assessment=outcome["assessment"],
                snapshot=outcome["snapshot"],
            ),
        )
    else:
        event = {
            "action": "none",
            "eventId": "",
            "eventNo": "",
            "message": "该点位没有适用的启用规则，未生成预警事件",
        }
    return {"record": record_out(row), "assessment": outcome["assessment"], "event": event}


def _apply_revision(row: MonitorRecord, workspace: Workspace, update: RevisionUpdate) -> None:
    payload = update.payload
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
    row.is_backfill = update.check["backfill"]
    row.baseline_version = update.baseline["version"] if update.baseline is not None else None
    row.baseline_values = update.baseline["values"] if update.baseline is not None else None
    row.revisions = [
        *(row.revisions or []),
        {
            "at": update.at,
            "by": workspace.actor.name,
            "role": ROLES.get(workspace.actor.role, workspace.actor.role),
            "reason": update.reason,
            "before": before,
        },
    ]
    row.record_revision += 1
    row.rule_id = update.snapshot["ruleId"] if update.snapshot is not None else None
    row.rule_version = update.snapshot["ruleVersion"] if update.snapshot is not None else None
    row.rule_snapshot = update.snapshot
    row.assessment = update.assessment
    bump(row, workspace, update.at)


def revise_record(session: Session, workspace: Workspace, command: RevisionCommand) -> dict:
    require_role(workspace, RECORD_ROLES, "监测记录修订")
    reason = command.reason.strip()
    if reason == "":
        raise AppError("REASON_REQUIRED", "修订必须填写原因", 422)
    row = get_row(session, MonitorRecord, workspace.dataset_id, command.record_id, "监测记录")
    require_revision(command.expected_rev, row)
    point = _point_for_record(session, workspace, row.point_id)
    payload = command.payload
    check = _validate(session, workspace, point, payload, row.id)
    normalized = {**payload, "quality": "invalid" if check["outOfRange"] else payload["quality"]}
    outcome = _assess(session, workspace, point, normalized, row.id)
    at = now_iso()
    update = RevisionUpdate(
        payload={**normalized, "reason": reason},
        check=check,
        baseline=outcome["baseline"],
        snapshot=outcome["snapshot"],
        assessment=outcome["assessment"],
        at=at,
        reason=reason,
    )
    _apply_revision(row, workspace, update)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="revise",
            object_type="record",
            object_id=row.id,
            object_label=f"{row.record_no} {point.code} {point.name}",
            summary=f"修订监测记录 {row.record_no}（第 {row.record_revision} 次）",
            reason=reason,
        ),
    )
    if outcome["snapshot"] is not None:
        event = apply_assessment(
            session,
            workspace,
            AssessmentCommand(
                record=row,
                assessment=outcome["assessment"],
                snapshot=outcome["snapshot"],
                revision_reason=reason,
            ),
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
