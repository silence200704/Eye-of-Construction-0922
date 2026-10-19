"""事件与通知命令：确认、关闭、展示、确认与超时升级。"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....core.errors import AppError
from ....db.models.archive import Point
from ....db.models.field import Issue, WorkOrder
from ....db.models.monitoring import AlarmEvent, AlarmNotification
from ....domain.monitoring.engine import parse_iso
from ....domain.monitoring.events import close_guard
from ...identity_types import ROLES
from ..core.serialize import event_out, notification_out
from ..core.workspace import (
    CLOSE_ROLES,
    NOTIFY_ROLES,
    AuditEntry,
    Workspace,
    bump,
    now_iso,
    require_revision,
    require_role,
    require_target_building,
    write_audit,
)
from .recovery import current_recovery
from .shared import timeline_item


def list_events(session: Session, workspace: Workspace, status: str = "all") -> list[dict]:
    query = select(AlarmEvent).where(AlarmEvent.dataset_id == workspace.dataset_id)
    if status == "open":
        query = query.where(AlarmEvent.status != "closed")
    elif status == "closed":
        query = query.where(AlarmEvent.status == "closed")
    rows = session.scalars(query.order_by(AlarmEvent.last_trigger_at.desc()))
    return [event_out(row) for row in rows]


def list_notifications(
    session: Session, workspace: Workspace, event_id: str | None = None
) -> list[dict]:
    query = select(AlarmNotification).where(AlarmNotification.dataset_id == workspace.dataset_id)
    if event_id:
        query = query.where(AlarmNotification.event_id == event_id)
    rows = session.scalars(query.order_by(AlarmNotification.created_at.asc()))
    return [notification_out(row) for row in rows]


def _event_of(session: Session, workspace: Workspace, event_id: str) -> AlarmEvent:
    row = session.get(AlarmEvent, (workspace.dataset_id, event_id))
    if row is None:
        raise AppError("NOT_FOUND", "预警事件不存在", 404, {"eventId": event_id})
    point = session.get(Point, (workspace.dataset_id, row.point_id))
    require_target_building(workspace, point.building_id if point is not None else None, "预警事件")
    return row


def acknowledge_event(
    session: Session, workspace: Workspace, event_id: str, expected_rev: int | None
) -> dict:
    require_role(workspace, CLOSE_ROLES, "确认预警事件")
    row = _event_of(session, workspace, event_id)
    require_revision(expected_rev, row)
    if row.status != "pending":
        raise AppError(
            "STATE_CONFLICT", "只有待确认事件可以转入处理中", 409, {"status": row.status}
        )
    at = now_iso()
    row.status = "handling"
    row.acknowledged_at = at
    row.acknowledged_by = workspace.actor.name
    row.timeline = [
        *row.timeline,
        timeline_item(
            at,
            workspace,
            "确认事件，转入处理中",
            f"{ROLES.get(workspace.actor.role, workspace.actor.role)} 确认",
        ),
    ]
    bump(row, workspace, at)
    notes = list(
        session.scalars(
            select(AlarmNotification).where(
                AlarmNotification.dataset_id == workspace.dataset_id,
                AlarmNotification.event_id == row.id,
                AlarmNotification.acknowledged_at.is_(None),
            )
        )
    )
    for note in notes:
        note.acknowledged_at = at
        note.acknowledged_by = workspace.actor.name
        bump(note, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="record",
            object_id=row.id,
            object_label=row.event_no,
            summary=f"确认预警事件 {row.event_no}，转入处理中",
            at=at,
        ),
    )
    return event_out(row)


@dataclass(frozen=True)
class CloseCommand:
    event_id: str
    expected_rev: int | None
    basis: str
    no_repair_note: str


def _legal_event_orders(
    session: Session, workspace: Workspace, event: AlarmEvent, orders: list[WorkOrder]
) -> list[WorkOrder]:
    """关闭依据必须来自该事件的传感器问题链，不接受客户端间接写入的 event_id。"""
    legal: list[WorkOrder] = []
    for order in orders:
        if order.origin != "event" or not order.issue_id:
            continue
        issue = session.get(Issue, (workspace.dataset_id, order.issue_id))
        if (
            issue is not None
            and issue.source == "sensor"
            and issue.event_id == event.id
            and issue.point_id == event.point_id
        ):
            legal.append(order)
    return legal


def close_event(session: Session, workspace: Workspace, command: CloseCommand) -> dict:
    require_role(workspace, CLOSE_ROLES, "关闭预警事件")
    row = _event_of(session, workspace, command.event_id)
    require_revision(command.expected_rev, row)
    guard = close_guard(row.status, workspace.actor.role)
    if not guard["allowed"]:
        raise AppError("STATE_CONFLICT", guard["reason"], 409)
    if not current_recovery(session, workspace, row):
        raise AppError("STATE_CONFLICT", "当前有效采样序列不满足恢复条件，请重新复测", 409)
    if command.basis.strip() == "":
        raise AppError("CLOSE_BASIS_REQUIRED", "关闭事件必须填写关闭依据", 422)
    verified_orders = _legal_event_orders(
        session,
        workspace,
        row,
        list(
            session.scalars(
                select(WorkOrder).where(
                    WorkOrder.dataset_id == workspace.dataset_id,
                    WorkOrder.event_id == row.id,
                    WorkOrder.status == "verified",
                )
            )
        ),
    )
    note = command.no_repair_note.strip()
    if note == "" and not verified_orders:
        raise AppError(
            "CLOSE_BASIS_REQUIRED",
            "关闭事件必须有当前事件关联且验收通过的工单，或填写“无需维修”现场核查结论",
            422,
        )
    basis_detail = (
        f"现场核查：{note}"
        if note != ""
        else "关联工单 " + "、".join(order.order_no for order in verified_orders) + " 已验收通过"
    )
    at = now_iso()
    detail = f"事件 {row.event_no} 授权关闭；复查结论：{command.basis.strip()}；{basis_detail}"
    row.status = "closed"
    row.closed_at = at
    row.closed_by = workspace.actor.name
    row.close_basis = command.basis.strip()
    row.timeline = [*row.timeline, timeline_item(at, workspace, "关闭事件", detail)]
    bump(row, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="record",
            object_id=row.id,
            object_label=row.event_no,
            summary=f"关闭预警事件 {row.event_no}",
            reason=f"{command.basis.strip()}；{basis_detail}",
            at=at,
        ),
    )
    return event_out(row)


def _notification_of(
    session: Session, workspace: Workspace, notification_id: str
) -> AlarmNotification:
    row = session.get(AlarmNotification, (workspace.dataset_id, notification_id))
    if row is None:
        raise AppError("NOT_FOUND", "通知不存在", 404, {"notificationId": notification_id})
    return row


def present_notification(session: Session, workspace: Workspace, notification_id: str) -> dict:
    require_role(workspace, NOTIFY_ROLES, "登记通知展示")
    row = _notification_of(session, workspace, notification_id)
    if row.presented_at is None:
        at = now_iso()
        row.presented_at = at
        bump(row, workspace, at)
        write_audit(
            session,
            workspace,
            AuditEntry(
                action="update",
                object_type="record",
                object_id=row.event_id,
                object_label=row.event_no,
                summary=f"通知已展示：{row.event_no} → {row.target}",
                at=at,
            ),
        )
    return notification_out(row)


def acknowledge_notification(session: Session, workspace: Workspace, notification_id: str) -> dict:
    require_role(workspace, NOTIFY_ROLES, "确认通知")
    row = _notification_of(session, workspace, notification_id)
    if row.acknowledged_at is None:
        at = now_iso()
        row.acknowledged_at = at
        row.acknowledged_by = workspace.actor.name
        bump(row, workspace, at)
        write_audit(
            session,
            workspace,
            AuditEntry(
                action="update",
                object_type="record",
                object_id=row.event_id,
                object_label=row.event_no,
                summary=f"确认通知：{row.event_no} → {row.target}",
                at=at,
            ),
        )
    return notification_out(row)


def escalate_due(session: Session, workspace: Workspace) -> dict:
    require_role(workspace, NOTIFY_ROLES, "执行通知超时核验")
    at = now_iso()
    now = parse_iso(at)
    rows = list(
        session.scalars(
            select(AlarmNotification).where(
                AlarmNotification.dataset_id == workspace.dataset_id,
                AlarmNotification.acknowledged_at.is_(None),
                AlarmNotification.escalated_at.is_(None),
            )
        )
    )
    closed_ids = set(
        session.scalars(
            select(AlarmEvent.id).where(
                AlarmEvent.dataset_id == workspace.dataset_id,
                AlarmEvent.status == "closed",
            )
        )
    )
    escalated: list[dict] = []
    for row in rows:
        if row.event_id in closed_ids:
            continue
        created = parse_iso(row.created_at)
        if created is None or now is None:
            continue
        if now - created <= timedelta(minutes=row.due_minutes):
            continue
        row.escalated_at = at
        row.escalated_to = row.fallback
        row.escalation_source = ""
        bump(row, workspace, at)
        escalated.append(notification_out(row))
        write_audit(
            session,
            workspace,
            AuditEntry(
                action="update",
                object_type="record",
                object_id=row.event_id,
                object_label=row.event_no,
                summary=f"通知超时升级：{row.event_no} → {row.escalated_to}",
                reason=(
                    f"{row.due_minutes} 分钟未确认，转{row.fallback}；"
                    "按服务端时间核验，不是外部渠道送达"
                ),
                at=at,
            ),
        )
    return {"escalated": len(escalated), "rows": escalated}
