"""维修工单：派工、接单、完工、验收与退回。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.field import WorkOrder
from ...db.models.identity import User
from ...domain.inspection import orders as order_rules
from ..datasets.core.workspace import (
    AuditEntry,
    Workspace,
    bump,
    now_iso,
    require_revision,
    require_role,
    require_target_building,
    uid,
    write_audit,
)
from .common import (
    PhotoOwner,
    PhotoSpec,
    attachment_out,
    get_issue,
    get_order,
    issue_out,
    link_photos,
    next_order_no,
    point_of,
    work_order_out,
)

STATUS_ACTION = {
    "assigned": "派工",
    "repairing": "接单处理",
    "submitted": "提交待验收",
    "verified": "验收通过",
    "returned": "验收退回",
}


def list_orders(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(select(WorkOrder).where(WorkOrder.dataset_id == workspace.dataset_id))
    return [work_order_out(row) for row in rows]


def create_manual(session: Session, workspace: Workspace, payload: dict) -> dict:
    require_role(workspace, {"safety"}, "手工建单")
    at = now_iso()
    point_id = payload.get("pointId") or None
    if point_id:
        point_of(session, workspace, point_id)
    else:
        require_target_building(workspace, None, "手工工单")
    row = WorkOrder(
        dataset_id=workspace.dataset_id,
        id=uid("wo"),
        order_no=next_order_no(session, workspace, at),
        origin="manual",
        issue_id=None,
        event_id=None,
        point_id=point_id,
        title=str(payload.get("title", "")).strip() or "现场维修工单",
        status="created",
        assignee="",
        assignee_id="",
        assigned_by="",
        accepted_by_id="",
        assigned_at=None,
        due_at=payload.get("dueAt") or None,
        measures="",
        materials="",
        photos=[],
        submitted_at=None,
        reviews=[],
        timeline=[
            {
                "at": at,
                "by": workspace.actor.name,
                "byRole": workspace.actor.role,
                "action": "创建工单",
                "detail": payload.get("note", ""),
            }
        ],
        created_at=at,
        created_by=workspace.actor.name,
        updated_at=at,
        updated_by=workspace.actor.name,
    )
    session.add(row)
    session.flush()
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="create",
            object_type="system",
            object_id=row.id,
            object_label=f"{row.order_no} {row.title}",
            summary=f"手工创建维修工单 {row.order_no}",
            reason=payload.get("note", ""),
            at=at,
        ),
    )
    return {"order": work_order_out(row)}


def _candidate_order(order: WorkOrder, payload: dict, at: str, assignee: dict | None) -> dict:
    return {
        **work_order_out(order),
        "assignee": order.assignee if assignee is None else assignee["name"],
        "assignee_id": order.assignee_id if assignee is None else assignee["id"],
        "assigned_by": order.assigned_by if assignee is None else assignee["by"],
        "assigned_at": order.assigned_at if assignee is None else at,
        "due_at": payload.get("dueAt") if payload.get("dueAt") is not None else order.due_at,
        "measures": payload.get("measures")
        if payload.get("measures") is not None
        else order.measures,
        "materials": payload.get("materials")
        if payload.get("materials") is not None
        else order.materials,
        "accepted_by_id": order.accepted_by_id,
        "submitted_at": order.submitted_at,
        "photos": order.photos or [],
    }


def _apply_accepted(order: WorkOrder, accepted: dict, to: str, meta: dict) -> None:
    workspace = meta["workspace"]
    note = meta["note"]
    at = meta["at"]
    order.assignee = accepted["assignee"]
    order.assignee_id = accepted["assignee_id"]
    order.assigned_by = accepted["assigned_by"]
    order.assigned_at = accepted["assigned_at"]
    order.due_at = accepted["due_at"]
    order.accepted_by_id = accepted["accepted_by_id"]
    order.measures = accepted["measures"]
    order.materials = accepted["materials"]
    order.submitted_at = accepted["submitted_at"]
    order.status = to
    if to in {"verified", "returned"}:
        order.reviews = [
            *(order.reviews or []),
            {
                "at": at,
                "by": workspace.actor.name,
                "byRole": workspace.actor.role,
                "action": "verify" if to == "verified" else "return",
                "result": "pass" if to == "verified" else "fail",
                "note": note,
            },
        ]
    order.timeline = [
        *(order.timeline or []),
        {
            "at": at,
            "by": workspace.actor.name,
            "byRole": workspace.actor.role,
            "action": STATUS_ACTION[to],
            "detail": note,
        },
    ]


def _advance_issue(
    session: Session, workspace: Workspace, order: WorkOrder, note: str, at: str
) -> str:
    if order.status != "verified" or not order.issue_id:
        return ""
    issue = get_issue(session, workspace, order.issue_id)
    changed = order_rules.issue_after_verify(
        issue_out(issue), order.order_no, at, workspace.actor.name, workspace.actor.role
    )
    if changed is None:
        return ""
    issue.status = changed["status"]
    issue.timeline = changed["timeline"]
    bump(issue, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=issue.id,
            object_label=f"{issue.issue_no} {issue.anomaly_type}",
            summary=f"问题 {issue.issue_no}：工单 {order.order_no} 验收通过，进入待复查",
            reason=note,
            at=at,
        ),
    )
    return f"；问题 {issue.issue_no} 进入待复查"


def _dispatch_assignee(
    session: Session, workspace: Workspace, payload: dict, to: str
) -> dict | None:
    if to != "assigned":
        if payload.get("assigneeId"):
            raise AppError("STATE_CONFLICT", "只有派工动作可以修改维修人", 409)
        return None
    assignee_id = str(payload.get("assigneeId") or "").strip()
    if assignee_id == "":
        raise AppError("VALIDATION_FAILED", "派工必须指定维修人身份", 422)
    user = session.get(User, assignee_id)
    if user is None or not user.enabled or user.role not in order_rules.REPAIR_ROLES:
        raise AppError("VALIDATION_FAILED", "指定人员不存在、已停用或不具备维修/物业角色", 422)
    return {"id": user.id, "name": user.name, "by": workspace.actor.name}


def advance_order(session: Session, workspace: Workspace, order_id: str, payload: dict) -> dict:
    order = get_order(session, workspace, order_id)
    require_revision(payload.get("expectedRev"), order)
    to = payload.get("to")
    at = now_iso()
    note = str(payload.get("note", ""))
    assignee = _dispatch_assignee(session, workspace, payload, to)
    candidate = _candidate_order(order, payload, at, assignee)
    try:
        accepted = order_rules.advance(
            {
                "order": candidate,
                "to": to,
                "at": at,
                "actor": {
                    "id": workspace.actor.id,
                    "name": workspace.actor.name,
                    "role": workspace.actor.role,
                },
                "note": note,
            }
        )
    except ValueError as error:
        raise AppError("STATE_CONFLICT", str(error), 409) from error
    _apply_accepted(order, accepted, to, {"workspace": workspace, "note": note, "at": at})
    specs = [
        PhotoSpec(
            item["mediaId"], item["draftId"], item.get("kind", "acceptance"), item.get("thumbId")
        )
        for item in payload.get("photos") or []
    ]
    if specs:
        link_photos(
            session,
            workspace,
            PhotoOwner(work_order_id=order.id, point_id=order.point_id),
            specs,
        )
    issue_message = _advance_issue(session, workspace, order, note, at)
    bump(order, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=order.id,
            object_label=f"{order.order_no} {order.title}",
            summary=f"工单 {order.order_no}：{STATUS_ACTION[to]}",
            reason=note,
            at=at,
        ),
    )
    return {
        "order": work_order_out(order),
        "message": f"{STATUS_ACTION[to]}{issue_message}",
        "photos": [
            attachment_out(session, workspace, row)
            for row in _order_attachments(session, workspace, order.id)
        ],
    }


def _order_attachments(session: Session, workspace: Workspace, order_id: str):
    from ...db.models.media import Attachment

    return session.scalars(
        select(Attachment).where(
            Attachment.dataset_id == workspace.dataset_id, Attachment.work_order_id == order_id
        )
    ).all()
