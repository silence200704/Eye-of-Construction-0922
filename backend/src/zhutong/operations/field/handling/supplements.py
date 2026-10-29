"""在原问题追加补充材料，不覆盖原始报告或重复创建问题。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....core.errors import AppError
from ....db.models.media import Attachment, MediaFile
from ...datasets.core.workspace import (
    AuditEntry,
    Workspace,
    bump,
    now_iso,
    require_revision,
    write_audit,
)
from ..access import get_order, order_building
from ..common import PhotoOwner, issue_out, link_photos, work_order_out
from ..issues import _photo_specs
from .access import supplement_owner


def photo_totals(session: Session, workspace: Workspace, field: str, object_id: str) -> dict:
    column = Attachment.issue_id if field == "issue" else Attachment.work_order_id
    rows = session.execute(
        select(Attachment.id, MediaFile.size)
        .join(
            MediaFile,
            (MediaFile.dataset_id == Attachment.dataset_id) & (MediaFile.id == Attachment.media_id),
        )
        .where(Attachment.dataset_id == workspace.dataset_id, column == object_id)
    ).all()
    return {"existingPhotoCount": len(rows), "existingPhotoBytes": sum(row.size for row in rows)}


def context(session: Session, workspace: Workspace, issue_id: str) -> dict:
    issue = supplement_owner(session, workspace, issue_id)
    return {"issue": issue_out(issue), **photo_totals(session, workspace, "issue", issue.id)}


def order_context(session: Session, workspace: Workspace, order_id: str) -> dict:
    order = get_order(session, workspace, order_id)
    return {
        "order": work_order_out(order),
        "buildingId": order_building(session, workspace, order) or "",
        **photo_totals(session, workspace, "order", order.id),
    }


def submit(session: Session, workspace: Workspace, issue_id: str, payload: dict) -> dict:
    issue = supplement_owner(session, workspace, issue_id)
    require_revision(payload.get("expectedRev"), issue)
    if issue.status != "pending_review" or issue.review_action != "need_evidence":
        raise AppError("STATE_CONFLICT", "当前问题没有待补充的审核要求，请重新读取", 409)
    note = str(payload.get("note", "")).strip()
    if len(note) < 10:
        raise AppError("VALIDATION_FAILED", "补充说明不少于10字，原始描述不会被覆盖", 422)
    specs = _photo_specs(payload)
    if issue.review_category == "image" and not specs:
        raise AppError("VALIDATION_FAILED", "本次审核要求补充图片，请添加新照片", 422)
    before = list(issue.photos or [])
    link_photos(
        session,
        workspace,
        PhotoOwner(issue_id=issue.id, point_id=issue.point_id, building_id=issue.building_id),
        specs,
    )
    added = [photo for photo in issue.photos if photo not in before]
    if issue.review_category == "image" and not added:
        raise AppError("VALIDATION_FAILED", "请补充新的图片，已有附件不重复作为新证据", 422)
    at = now_iso()
    issue.timeline = [
        *(issue.timeline or []),
        {
            "at": at,
            "by": workspace.actor.name,
            "byRole": workspace.actor.role,
            "action": "提交补充材料",
            "detail": note,
            "photos": added,
            "reviewCategory": issue.review_category,
            "reviewNote": issue.review_note,
        },
    ]
    issue.review_action = None
    bump(issue, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=issue.id,
            object_label=issue.issue_no,
            summary=f"问题 {issue.issue_no} 提交补充材料",
            reason=note,
            at=at,
        ),
    )
    return {"issue": issue_out(issue)}
