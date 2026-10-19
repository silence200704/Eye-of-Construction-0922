"""巡检任务到点、逐点完成与任务内问题上报。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Point
from ...db.models.field import InspectionTask, Issue
from ...domain.inspection import tasks as task_rules
from ..datasets.core.workspace import (
    AuditEntry,
    Workspace,
    now_iso,
    require_revision,
    write_audit,
)
from .common import get_task, issue_out, point_of, task_out
from .issues import IssueOrigin, create_issue


def list_tasks(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(InspectionTask).where(InspectionTask.dataset_id == workspace.dataset_id)
    )
    return [task_out(row) for row in rows]


def _task_context(
    session: Session, workspace: Workspace, task_id: str, point_id: str, expected_rev: int | None
) -> tuple[InspectionTask, dict, Point]:
    task = get_task(session, workspace, task_id)
    require_revision(expected_rev, task)
    if workspace.actor.role != task.plan_snapshot.get("executorRole"):
        raise AppError("ROLE_FORBIDDEN", "当前身份不是该任务的执行角色", 403)
    result = next((row for row in task.results or [] if row.get("pointId") == point_id), None)
    if result is None:
        raise AppError("NOT_FOUND", "该点位不在本任务范围内", 404)
    point = point_of(session, workspace, point_id)
    if point.building_id != task.building_id:
        raise AppError("SCOPE_FORBIDDEN", "任务点位超出任务楼栋", 403)
    return task, result, point


def check_in(session: Session, workspace: Workspace, task_id: str, payload: dict) -> dict:
    task, result, point = _task_context(
        session, workspace, task_id, payload.get("pointId", ""), payload.get("expectedRev")
    )
    at = now_iso()
    next_result = task_rules.check_in(
        {
            "result": result,
            "point": {"nfc": point.nfc or {}},
            "method": payload.get("method", "nfc"),
            "label_read": payload.get("labelRead", ""),
            "fallback_reason": payload.get("fallbackReason", ""),
            "at": at,
        }
    )
    task.results = [
        next_result if row.get("pointId") == payload.get("pointId") else row
        for row in task.results or []
    ]
    task.updated_at = at
    task.updated_by = workspace.actor.name
    task.revision += 1
    attempt = next_result["attempts"][-1]
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=task.id,
            object_label=f"{task.task_no} {point.code} {point.name}",
            summary=f"到点尝试：{attempt['message']}",
            reason=f"方式：{attempt['method']}；标签：{attempt['labelRead'] or '未提供'}",
            at=at,
        ),
    )
    return {"task": task_out(task), "attempt": attempt}


def complete_point(session: Session, workspace: Workspace, task_id: str, payload: dict) -> dict:
    task, result, point = _task_context(
        session, workspace, task_id, payload.get("pointId", ""), payload.get("expectedRev")
    )
    linked_id = payload.get("linkedIssueId") or None
    issue_valid = False
    if linked_id is not None:
        issue = session.get(Issue, (workspace.dataset_id, linked_id))
        issue_valid = (
            issue is not None
            and issue.task_id == task.id
            and issue.point_id == payload.get("pointId")
            and issue.status != "closed"
        )
    required_keys = [
        item.get("key")
        for item in task.plan_snapshot.get("checklist") or []
        if item.get("required")
    ]
    try:
        next_result = task_rules.complete_check(
            {
                "result": result,
                "answers": payload.get("answers") or [],
                "required_keys": required_keys,
                "issue_valid": issue_valid,
                "linked_issue_id": linked_id,
                "reason": payload.get("noIssueReason", ""),
            }
        )
    except ValueError as error:
        raise AppError("CHECK_INCOMPLETE", str(error), 422) from error
    at = now_iso()
    task.results = [
        next_result if row.get("pointId") == payload.get("pointId") else row
        for row in task.results or []
    ]
    task.status = task_rules.task_status(task.results)
    if linked_id and issue_valid:
        task.issue_ids = sorted({*(task.issue_ids or []), linked_id})
        next_result["issueIds"] = [*(next_result.get("issueIds") or []), linked_id]
    task.updated_at = at
    task.updated_by = workspace.actor.name
    task.revision += 1
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=task.id,
            object_label=f"{task.task_no} {point.code} {point.name}",
            summary=f"提交检查完成（{point.code}）",
            reason=f"任务状态：{task.status}；异常处置：{payload.get('noIssueReason', '')}",
            at=at,
        ),
    )
    return {"task": task_out(task)}


def report_task_issue(session: Session, workspace: Workspace, task_id: str, payload: dict) -> dict:
    submission = str(payload.get("submissionId", "")).strip()
    existing = (
        session.scalar(
            select(Issue).where(
                Issue.dataset_id == workspace.dataset_id,
                Issue.submission_key == submission,
            )
        )
        if submission
        else None
    )
    expected_rev = payload.get("expectedRev")
    if existing is not None:
        if existing.task_id != task_id:
            raise AppError("STATE_CONFLICT", "该 submissionId 已被其他任务使用", 409)
        # 会话丢失或响应中断后的重试：用当前任务版本核对身份/点位，照片按草稿补关联。
        current = get_task(session, workspace, task_id)
        expected_rev = current.revision
    task, result, point = _task_context(
        session, workspace, task_id, payload.get("pointId", ""), expected_rev
    )
    issue, duplicated = create_issue(
        session,
        workspace,
        {
            **payload,
            "pointId": point.id,
            "buildingId": point.building_id,
            "floorId": point.floor_id,
            "zoneId": point.zone_id,
        },
        IssueOrigin(source="inspection", task_id=task.id),
    )
    at = now_iso()
    if duplicated:
        # 同一次上报的重试只补齐照片；任务关联、时间线与审计不重复写。
        return {"issue": issue_out(issue), "duplicated": True, "task": task_out(task)}
    result["issueIds"] = sorted({*(result.get("issueIds") or []), issue.id})
    result["abnormalHandling"] = {**result.get("abnormalHandling", {}), "linkedIssueId": issue.id}
    task.results = [result if row.get("pointId") == point.id else row for row in task.results or []]
    task.issue_ids = sorted({*(task.issue_ids or []), issue.id})
    task.updated_at = at
    task.updated_by = workspace.actor.name
    task.revision += 1
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=task.id,
            object_label=f"{task.task_no} {point.code} {point.name}",
            summary=f"任务关联问题 {issue.issue_no}",
            reason=f"照片 {len(issue.photos or [])} 张",
            at=at,
        ),
    )
    return {"issue": issue_out(issue), "duplicated": duplicated, "task": task_out(task)}
