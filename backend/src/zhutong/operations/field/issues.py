"""问题上报、关联来源与问题池读取。"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Building, Floor
from ...db.models.field import Issue
from ...db.models.monitoring import AlarmEvent
from ..datasets.core.workspace import (
    AuditEntry,
    Workspace,
    now_iso,
    require_building,
    require_role,
    uid,
    write_audit,
)
from .common import (
    PhotoOwner,
    PhotoSpec,
    attachment_out,
    issue_out,
    link_photos,
    next_issue_no,
    point_of,
)

REPORT_ROLES = {"safety", "property", "device", "inspector", "repair"}


@dataclass(frozen=True)
class IssueOrigin:
    """问题来源链：传感器事件、巡检任务或保养任务，三选一。"""

    source: str
    task_id: str | None = None
    maintenance_task_id: str | None = None
    event: AlarmEvent | None = None


def _location(
    session: Session, workspace: Workspace, payload: dict
) -> tuple[str, str, str, str | None]:
    point_id = payload.get("pointId") or None
    if point_id:
        point = point_of(session, workspace, point_id)
        return point.id, point.building_id, point.floor_id, point.zone_id
    building = session.get(Building, (workspace.dataset_id, payload.get("buildingId", "")))
    if building is None or building.status != "active":
        raise AppError("NOT_FOUND", "楼栋不存在或已归档", 404)
    require_building(workspace, building.id)
    floor_id = payload.get("floorId", "")
    if floor_id == "":
        return "", building.id, "", payload.get("zoneId", "")
    floor = session.get(Floor, (workspace.dataset_id, floor_id))
    if floor is None or floor.building_id != building.id:
        raise AppError("INVALID_FLOOR", "楼层不属于该楼栋", 422)
    return "", building.id, floor.id, payload.get("zoneId", "")


def _assert_submission(workspace: Workspace, payload: dict) -> str:
    key = str(payload.get("submissionId", "")).strip()
    if not key or len(key) > 200:
        raise AppError("VALIDATION_FAILED", "上报必须携带 submissionId，重试复用同一标识", 422)
    return key


def _photo_specs(payload: dict) -> list[PhotoSpec]:
    return [
        PhotoSpec(item["mediaId"], item["draftId"], item.get("kind", "scene"), item.get("thumbId"))
        for item in payload.get("photos") or []
    ]


def _merge_existing_photos(
    session: Session, workspace: Workspace, existing: Issue, payload: dict
) -> None:
    """同一次上报的重试可以补关联新照片；同一草稿不会重复占配额。"""
    before = len(existing.photos or [])
    link_photos(
        session,
        workspace,
        PhotoOwner(issue_id=existing.id, point_id=existing.point_id),
        _photo_specs(payload),
    )
    if len(existing.photos or []) == before:
        return
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=existing.id,
            object_label=f"{existing.issue_no} {existing.anomaly_type}",
            summary=(f"问题 {existing.issue_no} 补关联照片 {len(existing.photos) - before} 张"),
            reason="同一次上报的重试补齐照片",
            at=now_iso(),
        ),
    )


def _build_issue(
    session: Session,
    workspace: Workspace,
    payload: dict,
    origin: IssueOrigin,
    key: str,
) -> tuple[Issue, str, str, str]:
    source = origin.source
    event = origin.event
    if event is None and payload.get("eventId"):
        raise AppError(
            "VALIDATION_FAILED",
            "只有传感器预警转单可以携带事件 ID；人工、巡检和保养来源不能自行指定预警事件",
            422,
        )
    point_id, building_id, floor_id, zone_id = _location(session, workspace, payload)
    anomaly = str(payload.get("anomalyType", "")).strip()
    description = str(payload.get("description", "")).strip()
    if anomaly == "" or description == "":
        raise AppError("VALIDATION_FAILED", "异常类型与原始描述必填", 422)
    at = now_iso()
    issue = Issue(
        dataset_id=workspace.dataset_id,
        id=uid("iss"),
        issue_no=next_issue_no(session, workspace, at),
        source=source,
        submission_key=key,
        point_id=point_id or None,
        building_id=building_id,
        floor_id=floor_id or None,
        zone_id=zone_id,
        event_id=event.id if event is not None else None,
        task_id=origin.task_id,
        maintenance_task_id=origin.maintenance_task_id,
        anomaly_type=anomaly,
        description=description,
        photos=[],
        status="pending_review",
        review_action=None,
        review_category="",
        reviewed_at=None,
        reviewed_by="",
        review_note="",
        duplicate_of=None,
        linked_event_id=None,
        linked_from=[],
        work_order_ids=[],
        rechecks=[],
        timeline=[
            {
                "at": at,
                "by": workspace.actor.name,
                "byRole": workspace.actor.role,
                "action": "提交问题",
                "detail": f"来源：{source}；{description}",
            }
        ],
        created_at=at,
        created_by=workspace.actor.name,
        updated_at=at,
        updated_by=workspace.actor.name,
    )
    session.add(issue)
    session.flush()
    return issue, at, building_id, floor_id


def create_issue(
    session: Session,
    workspace: Workspace,
    payload: dict,
    origin: IssueOrigin,
) -> tuple[Issue, bool]:
    event = origin.event
    key = f"event:{event.id}" if event is not None else _assert_submission(workspace, payload)
    existing = session.scalar(
        select(Issue).where(Issue.dataset_id == workspace.dataset_id, Issue.submission_key == key)
    )
    if existing is not None:
        _merge_existing_photos(session, workspace, existing, payload)
        return existing, True
    issue, at, building_id, floor_id = _build_issue(session, workspace, payload, origin, key)
    link_photos(
        session,
        workspace,
        PhotoOwner(issue_id=issue.id, point_id=issue.point_id, building_id=issue.building_id),
        _photo_specs(payload),
    )
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="create",
            object_type="system",
            object_id=issue.id,
            object_label=f"{issue.issue_no} {issue.anomaly_type}",
            summary=f"提交问题 {issue.issue_no}",
            reason=(
                f"来源：{origin.source}；位置：{building_id}/{floor_id}；"
                f"照片 {len(issue.photos)} 张"
            ),
            at=at,
        ),
    )
    return issue, False


def report_issue(session: Session, workspace: Workspace, payload: dict) -> dict:
    require_role(workspace, REPORT_ROLES, "问题上上报")
    source = payload.get("source", "report")
    if source not in {"report", "sensor"}:
        raise AppError("VALIDATION_FAILED", "该入口只接受人工上报或预警转单", 422)
    event = None
    if source == "sensor":
        require_role(workspace, {"safety"}, "预警转单")
        event = session.get(AlarmEvent, (workspace.dataset_id, payload.get("eventId", "")))
        if event is None:
            raise AppError("NOT_FOUND", "预警事件不存在", 404)
        if event.point_id != payload.get("pointId"):
            raise AppError("VALIDATION_FAILED", "问题测点与预警事件测点不一致", 422)
    issue, duplicated = create_issue(
        session, workspace, payload, IssueOrigin(source=source, event=event)
    )
    return {"issue": issue_out(issue), "duplicated": duplicated}


def list_issues(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(select(Issue).where(Issue.dataset_id == workspace.dataset_id))
    return [issue_out(row) for row in rows]


def list_attachments(session: Session, workspace: Workspace) -> list[dict]:
    from ...db.models.media import Attachment

    rows = session.scalars(select(Attachment).where(Attachment.dataset_id == workspace.dataset_id))
    return [attachment_out(session, workspace, row) for row in rows]
