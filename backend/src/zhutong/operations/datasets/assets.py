"""测点与设备写入，以及四类档案的归档/恢复。"""

from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Building, Device, Floor, Point
from ...domain.monitoring.catalog import POINT_METRICS, POINT_TYPES
from .core.helpers import ArchiveAudit, audit_archive, coord_of, ensure_code, ensure_nfc, get_row
from .core.serialize import device_out, point_out
from .core.workspace import (
    ARCHIVE_ROLES,
    AuditEntry,
    Workspace,
    bump,
    now_iso,
    require_building,
    require_revision,
    require_role,
    uid,
    write_audit,
)


@dataclass(frozen=True)
class PointWrite:
    payload: dict
    object_id: str | None
    expected_rev: int | None


@dataclass(frozen=True)
class PointTarget:
    building: Building
    floor: Floor
    existing: Point | None
    x: float
    y: float
    label: str
    moved: bool


@dataclass(frozen=True)
class DeviceWrite:
    payload: dict
    object_id: str | None
    expected_rev: int | None


@dataclass(frozen=True)
class DeviceSpec:
    payload: dict
    point_id: str | None
    low: float | None
    high: float | None
    at: str


@dataclass(frozen=True)
class ArchiveCommand:
    kind: str
    object_id: str
    archived: bool
    reason: str
    expected_rev: int | None


def _nfc_label(payload: dict, code: str) -> str:
    label = str(payload.get("nfcLabel", "")).strip()
    return label or f"NFC-{code.upper()}"


def _build_nfc(existing: Point | None, label: str, at: str, actor_name: str) -> dict:
    if existing is None or existing.nfc is None:
        return {
            "code": label,
            "version": 1,
            "boundAt": at,
            "boundBy": actor_name,
            "remark": "建档时绑定",
        }
    if existing.nfc.get("code") == label:
        return dict(existing.nfc)
    return {
        "code": label,
        "version": int(existing.nfc.get("version", 1)) + 1,
        "boundAt": at,
        "boundBy": actor_name,
        "remark": "换绑标签，历史打卡保留当时编号与版本",
    }


def _location_of(point: Point) -> dict:
    return {
        "buildingId": point.building_id,
        "floorId": point.floor_id,
        "zoneId": point.zone_id,
        "coord": {"x": point.x, "y": point.y},
    }


def _moved(point: Point, payload: dict, x: float, y: float) -> bool:
    return (
        point.building_id != payload["buildingId"]
        or point.floor_id != payload["floorId"]
        or point.zone_id != payload.get("zoneId", "")
        or abs(point.x - x) > 1e-6
        or abs(point.y - y) > 1e-6
    )


def _point_target(session: Session, workspace: Workspace, write: PointWrite) -> PointTarget:
    payload = write.payload
    x, y = coord_of(payload, "coord")
    point_type = payload["type"]
    if point_type not in POINT_TYPES:
        raise AppError("VALIDATION_FAILED", "未知测点类型", 422)
    building = get_row(session, Building, workspace.dataset_id, payload["buildingId"], "楼栋")
    floor = get_row(session, Floor, workspace.dataset_id, payload["floorId"], "楼层")
    require_building(workspace, building.id)
    if floor.building_id != building.id:
        raise AppError("INVALID_FLOOR", "所选楼层不属于该楼栋", 422)
    existing = (
        None
        if write.object_id is None
        else get_row(session, Point, workspace.dataset_id, write.object_id, "测点")
    )
    if existing is None and (building.status != "active" or floor.status != "active"):
        raise AppError("STATE_CONFLICT", "楼栋或楼层已归档，不能新建测点", 409)
    if existing is not None:
        require_revision(write.expected_rev, existing)
    code = payload["code"].strip()
    ensure_code(session, Point, workspace, code, exclude=write.object_id)
    label = _nfc_label(payload, code)
    ensure_nfc(session, workspace, label, exclude=write.object_id)
    moved = existing is not None and _moved(existing, payload, x, y)
    if moved and str(payload.get("locationReason", "")).strip() == "":
        raise AppError("LOCATION_REASON_REQUIRED", "位置发生变化，必须填写位置变更原因", 422)
    return PointTarget(building, floor, existing, x, y, label, moved)


def _create_point(workspace: Workspace, payload: dict, target: PointTarget, at: str) -> Point:
    row = Point(
        dataset_id=workspace.dataset_id,
        id=uid("pnt"),
        code=payload["code"].strip(),
        name=payload["name"].strip(),
        building_id=target.building.id,
        floor_id=target.floor.id,
        zone_id=payload.get("zoneId", ""),
        type=payload["type"],
        metric=POINT_METRICS[payload["type"]],
        x=target.x,
        y=target.y,
        nfc_code=target.label,
        nfc=_build_nfc(None, target.label, at, workspace.actor.name),
        plan_version=payload.get("planVersion", 1),
        location_history=[],
        owner=payload.get("owner", ""),
        backup_person=payload.get("backupPerson", ""),
        install_date=payload.get("installDate", ""),
        data_source=payload.get("dataSource", "demo"),
        remark=payload.get("remark", ""),
        status="active",
        created_at=at,
        created_by=workspace.actor.name,
        updated_at=at,
        updated_by=workspace.actor.name,
    )
    return row


def _update_point(
    row: Point, workspace: Workspace, payload: dict, target: PointTarget, at: str
) -> None:
    if target.moved:
        row.location_history = [
            *(row.location_history or []),
            {
                "at": at,
                "by": workspace.actor.name,
                "role": workspace.actor.role,
                "reason": str(payload.get("locationReason", "")).strip(),
                "from": _location_of(row),
                "to": {
                    "buildingId": target.building.id,
                    "floorId": target.floor.id,
                    "zoneId": payload.get("zoneId", ""),
                    "coord": {"x": target.x, "y": target.y},
                },
            },
        ]
    row.code = payload["code"].strip()
    row.name = payload["name"].strip()
    row.building_id = target.building.id
    row.floor_id = target.floor.id
    row.zone_id = payload.get("zoneId", "")
    row.type = payload["type"]
    row.metric = POINT_METRICS[payload["type"]]
    row.x = target.x
    row.y = target.y
    row.nfc_code = target.label
    row.nfc = _build_nfc(row, target.label, at, workspace.actor.name)
    row.plan_version = payload.get("planVersion", 1)
    row.owner = payload.get("owner", "")
    row.backup_person = payload.get("backupPerson", "")
    row.install_date = payload.get("installDate", "")
    row.data_source = payload.get("dataSource", "demo")
    row.remark = payload.get("remark", "")
    bump(row, workspace, at)


def save_point(session: Session, workspace: Workspace, write: PointWrite) -> dict:
    require_role(workspace, ARCHIVE_ROLES, "测点档案写入")
    at = now_iso()
    target = _point_target(session, workspace, write)
    if target.existing is None:
        row = _create_point(workspace, write.payload, target, at)
        session.add(row)
        created = True
    else:
        row = target.existing
        _update_point(row, workspace, write.payload, target, at)
        created = False
    try:
        session.flush()
    except IntegrityError as error:
        raise AppError("DUPLICATE_CODE", "测点编号或 NFC 标签重复", 409) from error
    label = f"{row.code} {row.name}"
    audit_archive(session, workspace, ArchiveAudit("point", row, label, created, at))
    if target.moved:
        write_audit(
            session,
            workspace,
            AuditEntry(
                action="update",
                object_type="point",
                object_id=row.id,
                object_label=label,
                summary=f"测点 {row.code} 位置变更",
                reason=str(write.payload.get("locationReason", "")).strip(),
                at=at,
            ),
        )
    return point_out(row)


def _range_text(low: float | None, high: float | None, unit: str) -> str:
    if low is None or high is None:
        return ""
    return f"{low}~{high}{'' if unit.strip() == '' else f' {unit.strip()}'}"


def _device_spec(payload: dict) -> DeviceSpec:
    low = payload.get("rangeMin")
    high = payload.get("rangeMax")
    if low is not None and high is not None and low >= high:
        raise AppError("INVALID_RANGE", "量程上限必须大于下限", 422)
    return DeviceSpec(
        payload=payload, point_id=payload.get("pointId"), low=low, high=high, at=now_iso()
    )


def _new_device(workspace: Workspace, spec: DeviceSpec) -> Device:
    payload = spec.payload
    return Device(
        dataset_id=workspace.dataset_id,
        id=uid("dev"),
        code=payload["code"].strip(),
        name=payload["name"].strip(),
        point_id=spec.point_id,
        model=payload.get("model", ""),
        serial=payload.get("serial", ""),
        range_min=spec.low,
        range_max=spec.high,
        range_text=_range_text(spec.low, spec.high, payload.get("unit", "")),
        unit=payload.get("unit", ""),
        node_id=payload.get("nodeId", ""),
        gateway=payload.get("gateway", ""),
        mount_position=payload.get("mountPosition", ""),
        direction=payload.get("direction", ""),
        install_date=payload.get("installDate", ""),
        calibrated_at=payload.get("calibratedAt", ""),
        health=payload.get("health", "unknown"),
        remark=payload.get("remark", ""),
        status="active",
        created_at=spec.at,
        created_by=workspace.actor.name,
        updated_at=spec.at,
        updated_by=workspace.actor.name,
    )


def _update_device(row: Device, workspace: Workspace, spec: DeviceSpec) -> None:
    payload = spec.payload
    row.code = payload["code"].strip()
    row.name = payload["name"].strip()
    row.point_id = spec.point_id
    for attr, key in (
        ("model", "model"),
        ("serial", "serial"),
        ("unit", "unit"),
        ("node_id", "nodeId"),
        ("gateway", "gateway"),
        ("mount_position", "mountPosition"),
        ("direction", "direction"),
        ("install_date", "installDate"),
        ("calibrated_at", "calibratedAt"),
        ("health", "health"),
        ("remark", "remark"),
    ):
        setattr(row, attr, payload.get(key, ""))
    row.range_min = spec.low
    row.range_max = spec.high
    row.range_text = _range_text(spec.low, spec.high, payload.get("unit", ""))
    bump(row, workspace, spec.at)


def save_device(session: Session, workspace: Workspace, write: DeviceWrite) -> dict:
    require_role(workspace, ARCHIVE_ROLES, "设备档案写入")
    payload = write.payload
    if payload.get("pointId") is not None:
        point = get_row(session, Point, workspace.dataset_id, payload["pointId"], "测点")
        require_building(workspace, point.building_id)
        if point.status != "active":
            raise AppError("STATE_CONFLICT", "测点已归档，不能绑定设备", 409)
    spec = _device_spec(payload)
    ensure_code(session, Device, workspace, payload["code"].strip(), exclude=write.object_id)
    if write.object_id is None:
        row = _new_device(workspace, spec)
        session.add(row)
        created = True
    else:
        row = get_row(session, Device, workspace.dataset_id, write.object_id, "设备")
        require_revision(write.expected_rev, row)
        _update_device(row, workspace, spec)
        created = False
    try:
        session.flush()
    except IntegrityError as error:
        raise AppError("DUPLICATE_CODE", "设备编号重复", 409) from error
    audit_archive(
        session,
        workspace,
        ArchiveAudit("device", row, f"{row.code} {row.name}", created, spec.at),
    )
    return device_out(row)
