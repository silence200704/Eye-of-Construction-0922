"""阶段 5 共用：序列化、对象读取、编号与照片归属。"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Point
from ...db.models.field import (
    InspectionPlan,
    InspectionTask,
    Issue,
    MaintenancePlan,
    MaintenanceTask,
    WorkOrder,
)
from ...db.models.media import Attachment, MediaFile
from ...domain.inspection.schedule import day_key
from ..datasets.core.workspace import Workspace, require_building, uid
from .access import (  # noqa: F401  (兼容既有模块从 common 导入的读取器)
    get_issue,
    get_maintenance_plan,
    get_maintenance_task,
    get_order,
    get_plan,
    get_task,
)


def plan_out(row: InspectionPlan) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "kind": row.kind,
        "buildingId": row.building_id,
        "floorIds": row.floor_ids or [],
        "pointIds": row.point_ids or [],
        "cycle": row.cycle or {},
        "startDate": row.start_date,
        "endDate": row.end_date,
        "owner": row.owner,
        "executorRole": row.executor_role,
        "checklist": row.checklist or [],
        "enabled": row.enabled,
        "remark": row.remark,
        "createdAt": row.created_at,
        "createdBy": row.created_by,
        "updatedAt": row.updated_at,
        "updatedBy": row.updated_by,
        "rev": row.revision,
    }


def task_out(row: InspectionTask) -> dict:
    return {
        "id": row.id,
        "taskNo": row.task_no,
        "planId": row.plan_id,
        "buildingId": row.building_id,
        "planSnapshot": row.plan_snapshot or {},
        "plannedAt": row.planned_at,
        "dueAt": row.due_at,
        "status": row.status,
        "results": row.results or [],
        "issueIds": row.issue_ids or [],
        "createdAt": row.created_at,
        "createdBy": row.created_by,
        "updatedAt": row.updated_at,
        "updatedBy": row.updated_by,
        "rev": row.revision,
    }


def maintenance_plan_out(row: MaintenancePlan) -> dict:
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "deviceId": row.device_id,
        "pointId": row.point_id,
        "buildingId": row.building_id,
        "cycle": row.cycle or {},
        "startDate": row.start_date,
        "endDate": row.end_date,
        "owner": row.owner,
        "checklist": row.checklist or [],
        "enabled": row.enabled,
        "remark": row.remark,
        "createdAt": row.created_at,
        "createdBy": row.created_by,
        "updatedAt": row.updated_at,
        "updatedBy": row.updated_by,
        "rev": row.revision,
    }


def maintenance_task_out(row: MaintenanceTask) -> dict:
    return {
        "id": row.id,
        "taskNo": row.task_no,
        "planId": row.plan_id,
        "deviceId": row.device_id,
        "plannedAt": row.planned_at,
        "dueAt": row.due_at,
        "status": row.status,
        "snapshot": row.snapshot or {},
        "execution": row.execution,
        "timeline": row.timeline or [],
        "createdAt": row.created_at,
        "createdBy": row.created_by,
        "updatedAt": row.updated_at,
        "updatedBy": row.updated_by,
        "rev": row.revision,
    }


def issue_out(row: Issue) -> dict:
    return {
        "id": row.id,
        "issueNo": row.issue_no,
        "source": row.source,
        "submissionKey": row.submission_key,
        "pointId": row.point_id,
        "buildingId": row.building_id,
        "floorId": row.floor_id,
        "zoneId": row.zone_id,
        "eventId": row.event_id,
        "taskId": row.task_id,
        "maintenanceTaskId": row.maintenance_task_id,
        "anomalyType": row.anomaly_type,
        "description": row.description,
        "photos": row.photos or [],
        "status": row.status,
        "reviewAction": row.review_action,
        "reviewCategory": row.review_category,
        "reviewedAt": row.reviewed_at,
        "reviewedBy": row.reviewed_by,
        "reviewNote": row.review_note,
        "duplicateOf": row.duplicate_of,
        "linkedEventId": row.linked_event_id,
        "linkedFrom": row.linked_from or [],
        "workOrderIds": row.work_order_ids or [],
        "rechecks": row.rechecks or [],
        "timeline": row.timeline or [],
        "createdAt": row.created_at,
        "createdBy": row.created_by,
        "updatedAt": row.updated_at,
        "updatedBy": row.updated_by,
        "rev": row.revision,
    }


def work_order_out(row: WorkOrder) -> dict:
    return {
        "id": row.id,
        "orderNo": row.order_no,
        "origin": row.origin,
        "issueId": row.issue_id,
        "eventId": row.event_id,
        "pointId": row.point_id,
        "title": row.title,
        "status": row.status,
        "assignee": row.assignee,
        "assigneeId": row.assignee_id,
        "assignedBy": row.assigned_by,
        "assignedAt": row.assigned_at,
        "dueAt": row.due_at,
        "acceptedById": row.accepted_by_id,
        "measures": row.measures,
        "materials": row.materials,
        "photos": row.photos or [],
        "submittedAt": row.submitted_at,
        "reviews": row.reviews or [],
        "timeline": row.timeline or [],
        "createdAt": row.created_at,
        "createdBy": row.created_by,
        "updatedAt": row.updated_at,
        "updatedBy": row.updated_by,
        "rev": row.revision,
    }


def attachment_out(session: Session, workspace: Workspace, row: Attachment) -> dict:
    media = session.get(MediaFile, (workspace.dataset_id, row.media_id))
    if media is None:
        raise AppError("NOT_FOUND", "附件媒体不存在", 404)
    return {
        "id": row.id,
        "issueId": row.issue_id,
        "workOrderId": row.work_order_id,
        "maintenanceTaskId": row.maintenance_task_id,
        "kind": row.kind,
        "draftId": row.draft_id,
        "mediaId": media.id,
        "fileName": media.file_name,
        "mimeType": media.mime_type,
        "size": media.size,
        "sha256": media.sha256,
        "width": media.width,
        "height": media.height,
        "uploadedAt": media.uploaded_at,
        "uploadedBy": media.uploaded_by,
        "capturedAt": media.captured_at,
        "contentUrl": f"/api/v1/datasets/{workspace.dataset_id}/media/{media.id}/content",
        "thumbUrl": f"/api/v1/datasets/{workspace.dataset_id}/media/{media.id}/content",
        "rev": row.revision,
    }


def point_of(session: Session, workspace: Workspace, point_id: str) -> Point:
    point = session.get(Point, (workspace.dataset_id, point_id))
    if point is None or point.status != "active":
        raise AppError("NOT_FOUND", "测点不存在或已归档", 404, {"pointId": point_id})
    require_building(workspace, point.building_id)
    return point


def next_issue_no(session: Session, workspace: Workspace, at: str) -> str:
    from ..datasets.core.workspace import next_number

    return next_number(
        session,
        Issue,
        Issue.issue_no,
        workspace.dataset_id,
        f"ISS-{day_key(at).replace('-', '')}-",
    )


def next_order_no(session: Session, workspace: Workspace, at: str) -> str:
    from ..datasets.core.workspace import next_number

    return next_number(
        session,
        WorkOrder,
        WorkOrder.order_no,
        workspace.dataset_id,
        f"WO-{day_key(at).replace('-', '')}-",
    )


def next_task_no(session: Session, workspace: Workspace, at: str) -> str:
    from ..datasets.core.workspace import next_number

    return next_number(
        session,
        InspectionTask,
        InspectionTask.task_no,
        workspace.dataset_id,
        f"TK-{day_key(at).replace('-', '')}-",
    )


def next_maintenance_no(session: Session, workspace: Workspace, at: str) -> str:
    from ..datasets.core.workspace import next_number

    return next_number(
        session,
        MaintenanceTask,
        MaintenanceTask.task_no,
        workspace.dataset_id,
        f"MT-{day_key(at).replace('-', '')}-",
    )


@dataclass(frozen=True)
class PhotoSpec:
    media_id: str
    draft_id: str
    kind: str
    thumb_id: str | None = None


@dataclass(frozen=True)
class PhotoOwner:
    issue_id: str | None = None
    work_order_id: str | None = None
    maintenance_task_id: str | None = None
    point_id: str | None = None
    building_id: str | None = None


def _owner_context(
    session: Session, workspace: Workspace, owner: PhotoOwner
) -> tuple[Any, str | None, str | None]:
    if owner.issue_id:
        row = get_issue(session, workspace, owner.issue_id)
        return row, row.building_id, row.point_id
    if owner.work_order_id:
        row = get_order(session, workspace, owner.work_order_id)
        building_id = None
        if row.point_id:
            point = session.get(Point, (workspace.dataset_id, row.point_id))
            building_id = point.building_id if point else None
        return row, building_id, row.point_id
    row = get_maintenance_task(session, workspace, owner.maintenance_task_id or "")
    snapshot = row.snapshot or {}
    return row, snapshot.get("buildingId"), snapshot.get("pointId")


def _usage(
    session: Session, workspace: Workspace, owner: PhotoOwner
) -> tuple[list[Attachment], int]:
    column = (
        Attachment.issue_id
        if owner.issue_id
        else Attachment.work_order_id
        if owner.work_order_id
        else Attachment.maintenance_task_id
    )
    value = owner.issue_id or owner.work_order_id or owner.maintenance_task_id
    rows = list(
        session.scalars(
            select(Attachment).where(Attachment.dataset_id == workspace.dataset_id, column == value)
        )
    )
    used = 0
    for attachment in rows:
        media = session.get(MediaFile, (workspace.dataset_id, attachment.media_id))
        used += media.size if media is not None else 0
    return rows, used


@dataclass
class _PhotoState:
    row: Any
    point_id: str | None
    usage: dict


def _link_one(
    session: Session,
    workspace: Workspace,
    owner: PhotoOwner,
    spec: PhotoSpec,
    state: _PhotoState,
) -> str:
    row = state.row
    point_id = state.point_id
    usage = state.usage
    media = session.get(MediaFile, (workspace.dataset_id, spec.media_id))
    if media is None:
        raise AppError("NOT_FOUND", "照片媒体不存在", 404, {"mediaId": spec.media_id})
    if spec.kind == "acceptance":
        if workspace.actor.role != "safety":
            raise AppError("ROLE_FORBIDDEN", "验收照片只能由学校安全管理人员提交", 403)
        if not owner.work_order_id:
            raise AppError("VALIDATION_FAILED", "验收照片只能归属维修工单", 422)
    if media.uploaded_by != workspace.actor.id and workspace.actor.role != "safety":
        raise AppError("ROLE_FORBIDDEN", "只能关联本人上传的媒体", 403)
    if point_id and media.point_id and media.point_id != point_id:
        raise AppError("STATE_CONFLICT", "照片关联测点与归属对象不一致", 409)
    if not media.mime_type.startswith("image/"):
        raise AppError("VALIDATION_FAILED", "业务照片附件必须是图片", 422)
    if spec.thumb_id:
        thumb = session.get(MediaFile, (workspace.dataset_id, spec.thumb_id))
        if thumb is None or not thumb.mime_type.startswith("image/"):
            raise AppError("VALIDATION_FAILED", "缩略图不存在或不是图片", 422)
    existing = session.scalar(
        select(Attachment).where(
            Attachment.dataset_id == workspace.dataset_id,
            Attachment.draft_id == spec.draft_id,
        )
    )
    if existing is not None:
        same = (
            existing.media_id == spec.media_id
            and existing.issue_id == owner.issue_id
            and existing.work_order_id == owner.work_order_id
            and existing.maintenance_task_id == owner.maintenance_task_id
        )
        if not same:
            raise AppError("IDEMPOTENCY_CONFLICT", "此照片草稿标识已关联其他内容", 409)
        return existing.id
    if session.scalar(
        select(Attachment.id).where(
            Attachment.dataset_id == workspace.dataset_id,
            Attachment.media_id == spec.media_id,
        )
    ):
        raise AppError("STATE_CONFLICT", "此照片已关联业务对象，请复用原关联", 409)
    if usage["count"] >= 3 or usage["used"] + media.size > 600 * 1024:
        raise AppError("ATTACHMENT_LIMIT", "每个对象最多三张照片且总计不超过 600 KB", 422)
    attachment = Attachment(
        dataset_id=workspace.dataset_id,
        id=uid("att"),
        media_id=spec.media_id,
        thumb_id=spec.thumb_id,
        issue_id=owner.issue_id,
        work_order_id=owner.work_order_id,
        maintenance_task_id=owner.maintenance_task_id,
        kind=spec.kind,
        draft_id=spec.draft_id,
    )
    session.add(attachment)
    session.flush()
    usage["count"] += 1
    usage["used"] += media.size
    if owner.issue_id or owner.work_order_id:
        row.photos = [*(row.photos or []), attachment.id]
    # 保养照片在 execute 中写进 execution.photos
    return attachment.id


def link_photos(
    session: Session, workspace: Workspace, owner: PhotoOwner, specs: list[PhotoSpec]
) -> list[str]:
    """在调用方事务内写附件并校验归属、类型、配额；返回新建/复用的附件 ID。"""
    if not specs:
        return []
    row, building_id, point_id = _owner_context(session, workspace, owner)
    if building_id:
        require_building(workspace, building_id)
    rows, used = _usage(session, workspace, owner)
    state = _PhotoState(row=row, point_id=point_id, usage={"count": len(rows), "used": used})
    return [_link_one(session, workspace, owner, spec, state) for spec in specs]
