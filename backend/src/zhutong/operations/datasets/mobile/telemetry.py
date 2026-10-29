from sqlalchemy.orm import Session
from ....core.errors import AppError
from ....db.models.archive import Device, Point
from ..core.serialize import device_out
from ..core.workspace import (
    AuditEntry,
    Workspace,
    bump,
    now_iso,
    require_revision,
    require_role,
    require_target_building,
    write_audit,
)


def authorized(session: Session, workspace: Workspace, device_id: str) -> Device:
    require_role(workspace, {"safety", "device"}, "设置模拟设备状态")
    row = session.get(Device, (workspace.dataset_id, device_id))
    if row is None or row.status != "active":
        raise AppError("NOT_FOUND", "设备不存在或已归档", 404)
    point = session.get(Point, (workspace.dataset_id, row.point_id)) if row.point_id else None
    require_target_building(workspace, point.building_id if point else None, "设备")
    return row


def update(session: Session, workspace: Workspace, device_id: str, payload: dict) -> dict:
    row = authorized(session, workspace, device_id)
    require_revision(payload["expectedRev"], row)
    at = now_iso()
    row.telemetry = {
        "source": "simulation",
        "connection": payload["connection"],
        "batteryPercent": payload["batteryPercent"],
        "lastReportAt": payload["lastReportAt"],
        "updatedAt": at,
    }
    bump(row, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="device",
            object_id=row.id,
            object_label=row.name,
            summary="更新模拟设备状态（非真实心跳）",
            at=at,
        ),
    )
    return device_out(row)
