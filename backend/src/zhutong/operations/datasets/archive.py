"""档案读取与楼栋/楼层写入。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Building, Device, Floor, Point
from ...db.models.foundation import AuditLog
from ...db.models.monitoring import Baseline, MonitoringRule, MonitorRecord
from .core.helpers import audit_archive, ensure_code, get_row
from .core.serialize import (
    audit_out,
    baseline_out,
    building_out,
    device_out,
    floor_out,
    point_out,
    rule_out,
)
from .core.workspace import (
    ARCHIVE_ROLES,
    Workspace,
    bump,
    can_access_building,
    now_iso,
    require_building,
    require_revision,
    require_role,
    uid,
)


def snapshot(session: Session, workspace: Workspace) -> dict:
    def rows(model: Any) -> list[Any]:
        return list(session.scalars(select(model).where(model.dataset_id == workspace.dataset_id)))

    audits = list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.dataset_id == workspace.dataset_id)
            .order_by(AuditLog.at.desc())
            .limit(500)
        )
    )
    records = session.scalar(
        select(MonitorRecord.id).where(MonitorRecord.dataset_id == workspace.dataset_id).limit(1)
    )
    return {
        "epoch": workspace.epoch,
        "buildings": [building_out(row) for row in rows(Building)],
        "floors": [floor_out(row) for row in rows(Floor)],
        "points": [point_out(row) for row in rows(Point)],
        "devices": [device_out(row) for row in rows(Device)],
        "baselines": [baseline_out(row) for row in rows(Baseline)],
        "rules": [rule_out(row) for row in rows(MonitoringRule)],
        "hasRecords": records is not None,
        "audits": [audit_out(row) for row in audits],
    }


def list_audits(session: Session, workspace: Workspace, limit: int = 200) -> list[dict]:
    rows = session.scalars(
        select(AuditLog)
        .where(AuditLog.dataset_id == workspace.dataset_id)
        .order_by(AuditLog.at.desc())
        .limit(max(1, min(limit, 1000)))
    )
    return [audit_out(row) for row in rows]


def _footprint(payload: dict) -> dict:
    footprint = payload.get("footprint") or {}
    for key in ("x", "y", "w", "h", "rotate"):
        value = footprint.get(key, 0)
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise AppError("VALIDATION_FAILED", f"楼栋占位 {key} 必须是数值", 422)
    for key in ("x", "y"):
        if not 0 <= footprint.get(key, 0) <= 1:
            raise AppError("INVALID_COORDINATE", "楼栋图上位置必须落在 0—1 的底图范围内", 422)
    if footprint.get("w", 0) <= 0 or footprint.get("h", 0) <= 0:
        raise AppError("INVALID_COORDINATE", "楼栋占位宽深必须为正数", 422)
    return footprint


def save_building(
    session: Session,
    workspace: Workspace,
    payload: dict,
    object_id: str | None,
    expected_rev: int | None,
) -> dict:
    require_role(workspace, ARCHIVE_ROLES, "楼栋档案写入")
    at = now_iso()
    footprint = _footprint(payload)
    if object_id is None:
        code = payload["code"].strip()
        ensure_code(session, Building, workspace, code)
        if not can_access_building(workspace, None):
            raise AppError("SCOPE_FORBIDDEN", "当前身份无权新建楼栋", 403)
        row = Building(
            dataset_id=workspace.dataset_id,
            id=uid("bld"),
            code=code,
            name=payload["name"].strip(),
            purpose=payload.get("purpose", ""),
            build_year=payload.get("buildYear"),
            floor_count=payload.get("floorCount"),
            area=payload.get("area"),
            structure_type=payload.get("structureType", ""),
            manager_unit=payload.get("managerUnit", ""),
            user_unit=payload.get("userUnit", ""),
            owner=payload.get("owner", ""),
            owner_phone=payload.get("ownerPhone", ""),
            backup_person=payload.get("backupPerson", ""),
            source=payload.get("source", ""),
            footprint=footprint,
            data_source=payload.get("dataSource", "demo"),
            remark=payload.get("remark", ""),
            status="active",
            created_at=at,
            created_by=workspace.actor.name,
            updated_at=at,
            updated_by=workspace.actor.name,
        )
        session.add(row)
        created = True
    else:
        row = get_row(session, Building, workspace.dataset_id, object_id, "楼栋")
        require_revision(expected_rev, row)
        code = payload["code"].strip()
        ensure_code(session, Building, workspace, code, exclude=row.id)
        row.code = code
        row.name = payload["name"].strip()
        for attr, key in (
            ("purpose", "purpose"),
            ("structure_type", "structureType"),
            ("manager_unit", "managerUnit"),
            ("user_unit", "userUnit"),
            ("owner", "owner"),
            ("owner_phone", "ownerPhone"),
            ("backup_person", "backupPerson"),
            ("source", "source"),
            ("remark", "remark"),
        ):
            setattr(row, attr, payload.get(key, ""))
        row.build_year = payload.get("buildYear")
        row.floor_count = payload.get("floorCount")
        row.area = payload.get("area")
        row.footprint = footprint
        row.data_source = payload.get("dataSource", "demo")
        bump(row, workspace, at)
        created = False
    session.flush()
    audit_archive(session, workspace, "building", row, f"{row.code} {row.name}", created, at)
    return building_out(row)


def save_floor(
    session: Session,
    workspace: Workspace,
    payload: dict,
    object_id: str | None,
    expected_rev: int | None,
) -> dict:
    require_role(workspace, ARCHIVE_ROLES, "楼层档案写入")
    at = now_iso()
    building = get_row(session, Building, workspace.dataset_id, payload["buildingId"], "楼栋")
    require_building(workspace, building.id)
    if object_id is None:
        if building.status != "active":
            raise AppError("STATE_CONFLICT", "楼栋已归档，不能在其下新建楼层", 409)
        row = Floor(
            dataset_id=workspace.dataset_id,
            id=uid("flr"),
            building_id=building.id,
            floor_no=payload["floorNo"],
            name=payload["name"].strip(),
            zones=payload.get("zones") or [],
            plan_version=payload.get("planVersion", 1),
            remark=payload.get("remark", ""),
            status="active",
            created_at=at,
            created_by=workspace.actor.name,
            updated_at=at,
            updated_by=workspace.actor.name,
        )
        session.add(row)
        created = True
    else:
        row = get_row(session, Floor, workspace.dataset_id, object_id, "楼层")
        require_revision(expected_rev, row)
        row.building_id = building.id
        row.floor_no = payload["floorNo"]
        row.name = payload["name"].strip()
        row.zones = payload.get("zones") or []
        row.plan_version = payload.get("planVersion", 1)
        row.remark = payload.get("remark", "")
        bump(row, workspace, at)
        created = False
    try:
        session.flush()
    except IntegrityError as error:
        raise AppError("DUPLICATE_FLOOR", "同一楼栋下楼层号不能重复", 409) from error
    audit_archive(session, workspace, "floor", row, f"{building.name} {row.name}", created, at)
    return floor_out(row)
