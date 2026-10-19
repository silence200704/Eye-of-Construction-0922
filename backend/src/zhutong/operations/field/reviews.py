"""问题审核、关联、工单生成与复查轮次。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Point
from ...db.models.field import Issue, WorkOrder
from ...db.models.monitoring import AlarmEvent
from ...domain.inspection import issues as rules
from ..datasets.core.workspace import (
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
from .common import (
    PhotoOwner,
    attachment_out,
    get_issue,
    issue_out,
    link_photos,
    next_order_no,
    work_order_out,
)
from .issues import _photo_specs


def _resolve_link(
    session: Session, workspace: Workspace, issue: Issue, payload: dict
) -> tuple[Issue | None, AlarmEvent | None]:
    if payload.get("category") == "issue":
        target = get_issue(session, workspace, str(payload.get("duplicateOf") or ""))
        if target.id == issue.id:
            raise AppError("VALIDATION_FAILED", "不能把问题关联到它自己", 422)
        if target.status == "closed" and len(str(payload.get("note", "")).strip()) < 10:
            raise AppError(
                "VALIDATION_FAILED", "关联已关闭问题需在审核意见写明专门依据（不少于 10 个字）", 422
            )
        require_building(workspace, target.building_id)
        return target, None
    event = session.get(AlarmEvent, (workspace.dataset_id, str(payload.get("linkedEventId") or "")))
    if event is None:
        raise AppError("NOT_FOUND", "要关联的预警事件不存在", 404)
    point = session.get(Point, (workspace.dataset_id, event.point_id))
    if point is not None:
        require_building(workspace, point.building_id)
    return None, event


def _issue_attachments(session: Session, workspace: Workspace, issue_id: str):
    from ...db.models.media import Attachment

    return session.scalars(
        select(Attachment).where(
            Attachment.dataset_id == workspace.dataset_id, Attachment.issue_id == issue_id
        )
    ).all()


def _create_order_for_issue(
    session: Session, workspace: Workspace, issue: Issue, payload: dict, at: str
) -> WorkOrder:
    order = WorkOrder(
        dataset_id=workspace.dataset_id,
        id=uid("wo"),
        order_no=next_order_no(session, workspace, at),
        origin="event" if issue.source == "sensor" else "issue",
        issue_id=issue.id,
        event_id=issue.event_id,
        point_id=issue.point_id,
        title=f"{issue.anomaly_type}（{issue.issue_no}）",
        status="created",
        assignee="",
        assigned_by="",
        assigned_at=None,
        due_at=None,
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
                "detail": f"由问题 {issue.issue_no} 审核转维修生成，待派工",
            }
        ],
        created_at=at,
        created_by=workspace.actor.name,
        updated_at=at,
        updated_by=workspace.actor.name,
    )
    session.add(order)
    session.flush()
    issue.work_order_ids = [*(issue.work_order_ids or []), order.id]
    issue.timeline = [
        *(issue.timeline or []),
        {
            "at": at,
            "by": workspace.actor.name,
            "byRole": workspace.actor.role,
            "action": "生成维修工单",
            "detail": f"{order.order_no} 待派工",
        },
    ]
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="create",
            object_type="system",
            object_id=order.id,
            object_label=f"{order.order_no} {order.title}",
            summary=f"由问题 {issue.issue_no} 生成维修工单 {order.order_no}",
            reason=payload.get("note", ""),
            at=at,
        ),
    )
    return order


def _update_targets(
    workspace: Workspace,
    issue: Issue,
    target_issue: Issue | None,
    target_event: AlarmEvent | None,
    meta: dict,
) -> None:
    note = meta["note"]
    at = meta["at"]
    if target_issue is not None:
        target_issue.linked_from = [*(target_issue.linked_from or []), issue.id]
        target_issue.timeline = [
            *(target_issue.timeline or []),
            {
                "at": at,
                "by": workspace.actor.name,
                "byRole": workspace.actor.role,
                "action": "被关联",
                "detail": f"{issue.issue_no}（{issue.anomaly_type}）关联到本条问题：{note}",
            },
        ]
        bump(target_issue, workspace, at)
    if target_event is not None:
        target_event.timeline = [
            *(target_event.timeline or []),
            {
                "at": at,
                "by": workspace.actor.name,
                "action": "记录关联问题",
                "detail": f"问题 {issue.issue_no}（{issue.anomaly_type}）关联到本事件：{note}",
            },
        ]
        bump(target_event, workspace, at)


def _apply_review(
    issue: Issue,
    workspace: Workspace,
    payload: dict,
    meta: dict,
) -> None:
    status = meta["status"]
    target_issue = meta["target_issue"]
    target_event = meta["target_event"]
    at = meta["at"]
    issue.status = "repairing" if payload.get("action") == "to_repair" else status
    issue.review_action = payload.get("action")
    issue.review_category = payload.get("category", "")
    issue.reviewed_at = at
    issue.reviewed_by = workspace.actor.name
    issue.review_note = payload.get("note", "")
    issue.duplicate_of = target_issue.id if target_issue is not None else issue.duplicate_of
    issue.linked_event_id = target_event.id if target_event is not None else issue.linked_event_id
    linked = (
        target_issue.issue_no if target_issue else target_event.event_no if target_event else ""
    )
    issue.timeline = [
        *(issue.timeline or []),
        {
            "at": at,
            "by": workspace.actor.name,
            "byRole": workspace.actor.role,
            "action": f"审核：{payload.get('action')}（{payload.get('category')}）",
            "detail": payload.get("note", "") + (f"｜关联到 {linked}" if linked else ""),
        },
    ]


def review_issue(session: Session, workspace: Workspace, issue_id: str, payload: dict) -> dict:
    require_role(workspace, {"safety"}, "问题审核")
    issue = get_issue(session, workspace, issue_id)
    require_revision(payload.get("expectedRev"), issue)
    if issue.status == "closed":
        raise AppError("STATE_CONFLICT", "该问题已关闭，如需继续处理请新建问题并关联原记录", 409)
    at = now_iso()
    specs = _photo_specs(payload)
    if specs:
        link_photos(
            session,
            workspace,
            PhotoOwner(issue_id=issue.id, point_id=issue.point_id, building_id=issue.building_id),
            specs,
        )
    try:
        status = rules.review_action(
            {
                "action": payload.get("action"),
                "category": payload.get("category"),
                "note": payload.get("note", ""),
                "duplicate_of": payload.get("duplicateOf"),
                "linked_event_id": payload.get("linkedEventId"),
                "issue_id": issue.id,
                "status": issue.status,
                "photo_count": len(issue.photos or []),
                "no_photo_reason": payload.get("noPhotoReason", ""),
            }
        )
    except ValueError as error:
        raise AppError("REVIEW_INVALID", str(error), 422) from error
    target_issue = target_event = None
    if payload.get("action") == "link_object":
        target_issue, target_event = _resolve_link(session, workspace, issue, payload)
    meta = {
        "status": status,
        "target_issue": target_issue,
        "target_event": target_event,
        "at": at,
        "note": payload.get("note", ""),
    }
    _apply_review(issue, workspace, payload, meta)
    order = None
    if payload.get("action") == "to_repair":
        order = _create_order_for_issue(session, workspace, issue, payload, at)
    note = payload.get("note", "")
    meta["note"] = note
    _update_targets(workspace, issue, target_issue, target_event, meta)
    bump(issue, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=issue.id,
            object_label=f"{issue.issue_no} {issue.anomaly_type}",
            summary=f"审核问题 {issue.issue_no}",
            reason=f"{payload.get('action')}／{payload.get('category')}；{note}",
            at=at,
        ),
    )
    return {
        "issue": issue_out(issue),
        "order": work_order_out(order) if order is not None else None,
        "photos": [
            attachment_out(session, workspace, row)
            for row in _issue_attachments(session, workspace, issue.id)
        ],
    }


def register_recheck(session: Session, workspace: Workspace, issue_id: str, payload: dict) -> dict:
    require_role(workspace, {"safety"}, "复查登记")
    issue = get_issue(session, workspace, issue_id)
    require_revision(payload.get("expectedRev"), issue)
    at = now_iso()
    try:
        round_row = rules.register_recheck(
            {
                "issue": issue_out(issue),
                "subject": payload.get("subject", ""),
                "owner": payload.get("owner", ""),
                "due_date": payload.get("dueDate", ""),
                "at": at,
                "by": workspace.actor.name,
            }
        )
    except ValueError as error:
        raise AppError("RECHECK_INVALID", str(error), 422) from error
    issue.rechecks = [*(issue.rechecks or []), round_row]
    issue.timeline = [
        *(issue.timeline or []),
        {
            "at": at,
            "by": workspace.actor.name,
            "byRole": workspace.actor.role,
            "action": "登记复查",
            "detail": (
                f"复查事项：{round_row['subject']}；责任人：{round_row['owner']}；"
                f"目标日期：{round_row['dueDate']}"
            ),
        },
    ]
    bump(issue, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=issue.id,
            object_label=f"{issue.issue_no} {issue.anomaly_type}",
            summary=f"登记复查：{issue.issue_no}",
            reason=round_row["subject"],
            at=at,
        ),
    )
    return {"issue": issue_out(issue)}


def record_recheck(session: Session, workspace: Workspace, issue_id: str, payload: dict) -> dict:
    require_role(workspace, {"safety"}, "复查结论")
    issue = get_issue(session, workspace, issue_id)
    require_revision(payload.get("expectedRev"), issue)
    at = now_iso()
    try:
        result = rules.recheck_outcome(
            {
                "issue": issue_out(issue),
                "outcome": payload.get("outcome"),
                "note": payload.get("note", ""),
                "next_due_date": payload.get("nextDueDate", ""),
                "at": at,
                "by": workspace.actor.name,
            }
        )
    except ValueError as error:
        raise AppError("RECHECK_INVALID", str(error), 422) from error
    issue.status = result["status"]
    issue.rechecks = result["rechecks"]
    issue.timeline = [
        *(issue.timeline or []),
        {
            "at": at,
            "by": workspace.actor.name,
            "byRole": workspace.actor.role,
            "action": f"复查：{payload.get('outcome')}",
            "detail": payload.get("note", ""),
        },
    ]
    bump(issue, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=issue.id,
            object_label=f"{issue.issue_no} {issue.anomaly_type}",
            summary=f"问题 {issue.issue_no}：复查结论 {payload.get('outcome')}",
            reason=payload.get("note", ""),
            at=at,
        ),
    )
    return {"issue": issue_out(issue)}
