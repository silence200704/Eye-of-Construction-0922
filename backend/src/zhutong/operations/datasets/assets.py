"""测点与设备写入，以及四类档案的归档/恢复。"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Building, Device, Floor, Point
from ...domain.monitoring.catalog import POINT_METRICS, POINT_TYPES
from .core.helpers import audit_archive, coord_of, ensure_code, ensure_nfc, get_row
from .core.serialize import building_out, device_out, floor_out, point_out
from .core.workspace import (
    ARCHIVE_ROLES,
    Workspace,
    bump,
    now_iso,
    require_building,
    require_revision,
    require_role,
    uid,
    write_audit,
)

ARCHIVE_KINDS = {"building": Building, "floor": Floor, "point": Point, "device": Device}
SERIALIZERS = {
    "building": building_out,
    "floor": floor_out,
    "point": point_out,
    "device": device_out,
}


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


def save_point(
    session: Session,
    workspace: Workspace,
    payload: dict,
    object_id: str | None,
    expected_rev: int | None,
) -> dict:
    require_role(workspace, ARCHIVE_ROLES, "测点档案写入")
    at = now_iso()
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
        if object_id is None
        else get_row(session, Point, workspace.dataset_id, object_id, "测点")
    )
    if existing is None and (building.status != "active" or floor.status != "active"):
        raise AppError("STATE_CONFLICT", "楼栋或楼层已归档，不能新建测点", 409)
    if existing is not None:
        require_revision(expected_rev, existing)
    code = payload["code"].strip()
    ensure_code(session, Point, workspace, code, exclude=object_id)
    label = _nfc_label(payload, code)
    ensure_nfc(session, workspace, label, exclude=object_id)
    moved = existing is not None and _moved(existing, payload, x, y)
    if moved and str(payload.get("locationReason", "")).strip() == "":
        raise AppError("LOCATION_REASON_REQUIRED", "位置发生变化，必须填写位置变更原因", 422)

    if existing is None:
        row = Point(
            dataset_id=workspace.dataset_id,
            id=uid("pnt"),
            code=code,
            name=payload["name"].strip(),
            building_id=building.id,
            floor_id=floor.id,
            zone_id=payload.get("zoneId", ""),
            type=point_type,
            metric=POINT_METRICS[point_type],
            x=x,
            y=y,
            nfc_code=label,
            nfc=_build_nfc(None, label, at, workspace.actor.name),
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
        session.add(row)
        created = True
    else:
        row = existing
        if moved:
            row.location_history = [
                *(row.location_history or []),
                {
                    "at": at,
                    "by": workspace.actor.name,
                    "role": workspace.actor.role,
                    "reason": str(payload.get("locationReason", "")).strip(),
                    "from": _location_of(row),
                    "to": {
                        "buildingId": building.id,
                        "floorId": floor.id,
                        "zoneId": payload.get("zoneId", ""),
                        "coord": {"x": x, "y": y},
                    },
                },
            ]
        row.code = code
        row.name = payload["name"].strip()
        row.building_id = building.id
        row.floor_id = floor.id
        row.zone_id = payload.get("zoneId", "")
        row.type = point_type
        row.metric = POINT_METRICS[point_type]
        row.x = x
        row.y = y
        row.nfc_code = label
        row.nfc = _build_nfc(row, label, at, workspace.actor.name)
        row.plan_version = payload.get("planVersion", 1)
        row.owner = payload.get("owner", "")
        row.backup_person = payload.get("backupPerson", "")
        row.install_date = payload.get("installDate", "")
        row.data_source = payload.get("dataSource", "demo")
        row.remark = payload.get("remark", "")
        bump(row, workspace, at)
        created = False
    try:
        session.flush()
    except IntegrityError as error:
        raise AppError("DUPLICATE_CODE", "测点编号或 NFC 标签重复", 409) from error
    label_text = f"{row.code} {row.name}"
    audit_archive(session, workspace, "point", row, label_text, created, at)
    if moved:
        write_audit(
            session,
            workspace,
            action="update",
            object_type="point",
            object_id=row.id,
            object_label=label_text,
            summary=f"测点 {row.code} 位置变更",
            reason=str(payload.get("locationReason", "")).strip(),
            at=at,
        )
    return point_out(row)


def _range_text(low: float | None, high: float | None, unit: str) -> str:
    if low is None or high is None:
        return ""
    return f"{low}~{high}{'' if unit.strip() == '' else f' {unit.strip()}'}"


def save_device(
    session: Session,
    workspace: Workspace,
    payload: dict,
    object_id: str | None,
    expected_rev: int | None,
) -> dict:
    require_role(workspace, ARCHIVE_ROLES, "设备档案写入")
    at = now_iso()
    point_id = payload.get("pointId")
    if point_id is not None:
        point = get_row(session, Point, workspace.dataset_id, point_id, "测点")
        require_building(workspace, point.building_id)
        if point.status != "active":
            raise AppError("STATE_CONFLICT", "测点已归档，不能绑定设备", 409)
    low = payload.get("rangeMin")
    high = payload.get("rangeMax")
    if low is not None and high is not None and low >= high:
        raise AppError("INVALID_RANGE", "量程上限必须大于下限", 422)
    code = payload["code"].strip()
    ensure_code(session, Device, workspace, code, exclude=object_id)
    if object_id is None:
        row = Device(
            dataset_id=workspace.dataset_id,
            id=uid("dev"),
            code=code,
            name=payload["name"].strip(),
            point_id=point_id,
            model=payload.get("model", ""),
            serial=payload.get("serial", ""),
            range_min=low,
            range_max=high,
            range_text=_range_text(low, high, payload.get("unit", "")),
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
            created_at=at,
            created_by=workspace.actor.name,
            updated_at=at,
            updated_by=workspace.actor.name,
        )
        session.add(row)
        created = True
    else:
        row = get_row(session, Device, workspace.dataset_id, object_id, "设备")
        require_revision(expected_rev, row)
        row.code = code
        row.name = payload["name"].strip()
        row.point_id = point_id
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
        row.range_min = low
        row.range_max = high
        row.range_text = _range_text(low, high, payload.get("unit", ""))
        bump(row, workspace, at)
        created = False
    try:
        session.flush()
    except IntegrityError as error:
        raise AppError("DUPLICATE_CODE", "设备编号重复", 409) from error
    audit_archive(session, workspace, "device", row, f"{row.code} {row.name}", created, at)
    return device_out(row)


def _block_building_archive(session: Session, workspace: Workspace, row: Building) -> None:
    active = session.scalar(
        select(Point.id).where(
            Point.dataset_id == workspace.dataset_id,
            Point.building_id == row.id,
            Point.status == "active",
        )
    )
    if active is not None:
        raise AppError("DEPENDENTS_ACTIVE", "该楼栋下仍有在册测点，请先归档相关测点", 409)


def _block_floor_archive(session: Session, workspace: Workspace, row: Floor) -> None:
    active = session.scalar(
        select(Point.id).where(
            Point.dataset_id == workspace.dataset_id,
            Point.floor_id == row.id,
            Point.status == "active",
        )
    )
    if active is not None:
        raise AppError("DEPENDENTS_ACTIVE", "该楼层下仍有在册测点，请先归档相关测点", 409)


def _require_parents_active(session: Session, workspace: Workspace, kind: str, row) -> None:
    if kind == "floor":
        building = session.get(Building, (workspace.dataset_id, row.building_id))
        if building is None or building.status != "active":
            raise AppError("PARENT_ARCHIVED", "上级楼栋已归档，请先恢复楼栋", 409)
    if kind == "point":
        floor = session.get(Floor, (workspace.dataset_id, row.floor_id))
        building = session.get(Building, (workspace.dataset_id, row.building_id))
        if (
            floor is None
            or building is None
            or floor.status != "active"
            or building.status != "active"
        ):
            raise AppError("PARENT_ARCHIVED", "上级楼层或楼栋已归档，请先恢复上级对象", 409)
    if kind == "device" and row.point_id is not None:
        point = session.get(Point, (workspace.dataset_id, row.point_id))
        if point is None or point.status != "active":
            raise AppError("PARENT_ARCHIVED", "所属测点已归档，请先恢复测点", 409)


def _archive_devices_of_point(
    session: Session, workspace: Workspace, point_id: str, reason: str, at: str
) -> None:
    owned = list(
        session.scalars(
            select(Device).where(
                Device.dataset_id == workspace.dataset_id,
                Device.point_id == point_id,
                Device.status == "active",
            )
        )
    )
    for device in owned:
        device.status = "archived"
        device.archive_reason = reason
        device.archived_at = at
        device.archived_by = workspace.actor.name
        bump(device, workspace, at)


def archive_object(
    session: Session,
    workspace: Workspace,
    kind: str,
    object_id: str,
    archived: bool,
    reason: str,
    expected_rev: int | None,
) -> dict:
    require_role(workspace, ARCHIVE_ROLES, "档案归档/恢复")
    if archived and reason.strip() == "":
        raise AppError("REASON_REQUIRED", "归档必须填写原因", 422)
    model = ARCHIVE_KINDS.get(kind)
    if model is None:
        raise AppError("NOT_FOUND", "未知档案类型", 404)
    row = get_row(session, model, workspace.dataset_id, object_id, "档案对象")
    require_revision(expected_rev, row)
    building_id = row.id if kind == "building" else getattr(row, "building_id", None)
    if kind == "device" and row.point_id is not None:
        point = session.get(Point, (workspace.dataset_id, row.point_id))
        building_id = point.building_id if point is not None else None
    require_building(workspace, building_id)
    if archived and kind == "building":
        _block_building_archive(session, workspace, row)
    if archived and kind == "floor":
        _block_floor_archive(session, workspace, row)
    if not archived:
        _require_parents_active(session, workspace, kind, row)
    at = now_iso()
    row.status = "archived" if archived else "active"
    row.archive_reason = reason.strip() if archived else ""
    row.archived_at = at if archived else None
    row.archived_by = workspace.actor.name if archived else ""
    bump(row, workspace, at)
    if kind == "point" and archived:
        _archive_devices_of_point(session, workspace, row.id, reason, at)
    label = f"{row.code} {row.name}" if hasattr(row, "code") else object_id
    write_audit(
        session,
        workspace,
        action="archive" if archived else "restore",
        object_type=kind,
        object_id=row.id,
        object_label=label,
        summary=f"{'归档' if archived else '恢复'}{label}",
        reason=reason,
        at=at,
    )
    return SERIALIZERS[kind](row)
