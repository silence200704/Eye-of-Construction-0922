"""保养计划、周期任务与执行。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Building, Device, Point
from ...db.models.field import Issue, MaintenancePlan, MaintenanceTask
from ...domain.inspection import maintenance as rules
from ...domain.inspection.answers import normalize_answers
from ...domain.inspection.schedule import day_key, end_of_day, planned_at, valid_day
from ..datasets.core.workspace import (
    AuditEntry,
    Workspace,
    bump,
    can_access_building,
    now_iso,
    require_building,
    require_revision,
    require_role,
    uid,
    write_audit,
)
from .common import (
    PhotoOwner,
    PhotoSpec,
    attachment_out,
    get_maintenance_plan,
    get_maintenance_task,
    issue_out,
    link_photos,
    maintenance_plan_out,
    maintenance_task_out,
    next_maintenance_no,
    point_of,
)
from .issues import IssueOrigin, create_issue

PLAN_ROLES = {"safety", "device"}
GENERATE_ROLES = {"safety", "property", "device"}
EXECUTE_ROLES = {"safety", "property", "device", "repair"}


def _validate(session: Session, workspace: Workspace, payload: dict) -> Device:
    errors = rules.validate_plan(payload)
    if errors:
        raise AppError("VALIDATION_FAILED", "; ".join(errors), 422)
    device = session.get(Device, (workspace.dataset_id, payload.get("deviceId", "")))
    if device is None or device.status != "active":
        raise AppError("NOT_FOUND", "设备不存在或已归档", 404)
    if device.point_id:
        point = point_of(session, workspace, device.point_id)
        if point.building_id != (payload.get("buildingId") or point.building_id):
            raise AppError("SCOPE_FORBIDDEN", "设备不属于指定楼栋", 403)
    building = session.get(Building, (workspace.dataset_id, payload.get("buildingId", "")))
    if building is None or building.status != "active":
        raise AppError("NOT_FOUND", "楼栋不存在或已归档", 404)
    require_building(workspace, building.id)
    return device


def save_plan(
    session: Session,
    workspace: Workspace,
    payload: dict,
    plan_id: str | None,
    expected_rev: int | None,
) -> dict:
    require_role(workspace, PLAN_ROLES, "保养计划写入")
    device = _validate(session, workspace, payload)
    point = session.get(Point, (workspace.dataset_id, device.point_id)) if device.point_id else None
    at = now_iso()
    if plan_id is None:
        row = MaintenancePlan(
            dataset_id=workspace.dataset_id,
            id=uid("mp"),
            code="",
            name=payload["name"].strip(),
            device_id=device.id,
            point_id=device.point_id,
            building_id=point.building_id if point is not None else payload["buildingId"],
            cycle=payload.get("cycle") or {},
            start_date=payload["startDate"],
            end_date=payload.get("endDate") or None,
            owner=payload.get("owner", ""),
            checklist=payload.get("checklist") or [],
            enabled=bool(payload.get("enabled", True)),
            remark=payload.get("remark", ""),
            created_at=at,
            created_by=workspace.actor.name,
            updated_at=at,
            updated_by=workspace.actor.name,
        )
        from ..datasets.core.workspace import next_number

        row.code = next_number(
            session,
            MaintenancePlan,
            MaintenancePlan.code,
            workspace.dataset_id,
            f"MP-{day_key(at).replace('-', '')}-",
        )
        session.add(row)
        action = "create"
    else:
        row = get_maintenance_plan(session, workspace, plan_id)
        require_revision(expected_rev, row)
        row.name = payload["name"].strip()
        row.device_id = device.id
        row.point_id = device.point_id
        row.building_id = point.building_id if point is not None else payload["buildingId"]
        row.cycle = payload.get("cycle") or {}
        row.start_date = payload["startDate"]
        row.end_date = payload.get("endDate") or None
        row.owner = payload.get("owner", "")
        row.checklist = payload.get("checklist") or []
        row.enabled = bool(payload.get("enabled", row.enabled))
        row.remark = payload.get("remark", "")
        bump(row, workspace, at)
        action = "update"
    session.flush()
    write_audit(
        session,
        workspace,
        AuditEntry(
            action=action,
            object_type="system",
            object_id=row.id,
            object_label=f"{row.code} {row.name}",
            summary=f"{'新建' if action == 'create' else '编辑'}保养计划 {row.code}",
            reason=f"设备 {device.name}；负责人 {row.owner}",
            at=at,
        ),
    )
    return maintenance_plan_out(row)


def set_enabled(
    session: Session, workspace: Workspace, plan_id: str, enabled: bool, expected_rev: int | None
) -> dict:
    require_role(workspace, {"safety"}, "保养计划启停")
    row = get_maintenance_plan(session, workspace, plan_id)
    require_revision(expected_rev, row)
    at = now_iso()
    row.enabled = enabled
    bump(row, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=row.id,
            object_label=f"{row.code} {row.name}",
            summary=f"{'启用' if enabled else '停用'}保养计划 {row.code}",
            at=at,
        ),
    )
    return maintenance_plan_out(row)


def list_plans(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(MaintenancePlan).where(MaintenancePlan.dataset_id == workspace.dataset_id)
    )
    return [maintenance_plan_out(row) for row in rows]


def list_tasks(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(MaintenanceTask).where(MaintenanceTask.dataset_id == workspace.dataset_id)
    )
    return [maintenance_task_out(row) for row in rows]


def _snapshot(plan: MaintenancePlan, device: Device) -> dict:
    return {
        "planCode": plan.code,
        "planName": plan.name,
        "deviceCode": device.code,
        "deviceName": device.name,
        "pointId": plan.point_id,
        "buildingId": plan.building_id,
        "floorId": "",
        "zoneId": "",
        "owner": plan.owner,
        "cycle": plan.cycle or {},
        "checklist": [{**item} for item in plan.checklist or []],
    }


def generate(session: Session, workspace: Workspace, day: str) -> dict:
    require_role(workspace, GENERATE_ROLES, "生成保养任务")
    if not valid_day(day):
        raise AppError("VALIDATION_FAILED", "日期不是合法日期", 422)
    plans = session.scalars(
        select(MaintenancePlan).where(
            MaintenancePlan.dataset_id == workspace.dataset_id,
            MaintenancePlan.enabled.is_(True),
        )
    )
    created: list[dict] = []
    skipped = 0
    at = now_iso()
    for plan in plans:
        if not can_access_building(workspace, plan.building_id):
            continue
        planned = planned_at(
            {"startDate": plan.start_date, "endDate": plan.end_date, "cycle": plan.cycle or {}},
            day,
        )
        if planned is None:
            continue
        key = f"{plan.id}@{planned}"
        if session.get(MaintenanceTask, (workspace.dataset_id, key)) is not None:
            skipped += 1
            continue
        device = session.get(Device, (workspace.dataset_id, plan.device_id))
        if device is None:
            continue
        snapshot = _snapshot(plan, device)
        point = session.get(Point, (workspace.dataset_id, plan.point_id)) if plan.point_id else None
        if point is not None:
            snapshot["floorId"] = point.floor_id
            snapshot["zoneId"] = point.zone_id
        task = MaintenanceTask(
            dataset_id=workspace.dataset_id,
            id=key,
            task_no=next_maintenance_no(session, workspace, planned),
            plan_id=plan.id,
            device_id=plan.device_id,
            planned_at=planned,
            due_at=end_of_day(day),
            status="pending",
            snapshot=snapshot,
            execution=None,
            timeline=[
                {
                    "at": at,
                    "by": workspace.actor.name,
                    "byRole": workspace.actor.role,
                    "action": "生成保养任务",
                    "detail": f"按计划 {plan.code} 生成：{device.name}，负责人 {plan.owner}",
                }
            ],
            created_at=at,
            created_by=workspace.actor.name,
            updated_at=at,
            updated_by=workspace.actor.name,
        )
        session.add(task)
        session.flush()
        created.append(maintenance_task_out(task))
        write_audit(
            session,
            workspace,
            AuditEntry(
                action="create",
                object_type="system",
                object_id=task.id,
                object_label=f"{task.task_no} {plan.name}",
                summary=f"生成保养任务 {task.task_no}",
                reason=f"设备 {device.name}；计划 {plan.code}",
                at=at,
            ),
        )
    return {"created": created, "skipped": skipped}


def _execute_issue(
    session: Session, workspace: Workspace, task: MaintenanceTask, payload: dict
) -> Issue | None:
    if not payload.get("createIssue"):
        return None
    point_id = task.snapshot.get("pointId")
    building_id = task.snapshot.get("buildingId")
    floor_id = task.snapshot.get("floorId") or ""
    if point_id:
        floor_id = point_of(session, workspace, point_id).floor_id
    issue, _ = create_issue(
        session,
        workspace,
        {
            "pointId": point_id,
            "buildingId": building_id,
            "floorId": floor_id,
            "zoneId": task.snapshot.get("zoneId", ""),
            "anomalyType": "保养发现异常",
            "description": payload.get("abnormalNote", ""),
            "submissionId": f"maintenance:{task.id}",
            "photos": [],
        },
        IssueOrigin(source="maintenance", maintenance_task_id=task.id),
    )
    return issue


def _record_execution(
    session: Session,
    workspace: Workspace,
    task: MaintenanceTask,
    execution: dict,
) -> None:
    at = now_iso()
    measures = str(execution.get("measures", ""))
    next_due = str(execution.get("nextDueDate", ""))
    task.execution = {**execution, "at": at}
    task.status = "done"
    task.timeline = [
        *(task.timeline or []),
        {
            "at": at,
            "by": workspace.actor.name,
            "byRole": workspace.actor.role,
            "action": "完成保养",
            "detail": f"措施：{measures}；下次保养 {next_due}",
        },
    ]
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
            object_label=f"{task.task_no} {task.snapshot.get('deviceName', '')}",
            summary=f"完成保养任务 {task.task_no}",
            reason=measures,
            at=at,
        ),
    )
    return at


def execute(session: Session, workspace: Workspace, task_id: str, payload: dict) -> dict:
    require_role(workspace, EXECUTE_ROLES, "执行保养")
    task = get_maintenance_task(session, workspace, task_id)
    require_revision(payload.get("expectedRev"), task)
    answers = payload.get("answers") or []
    measures = str(payload.get("measures", ""))
    next_due = str(payload.get("nextDueDate", ""))
    try:
        answers = normalize_answers(answers, (task.snapshot or {}).get("checklist") or [])
        rules.validate_completion(maintenance_task_out(task), answers, measures, next_due)
    except ValueError as error:
        raise AppError("MAINTENANCE_INVALID", str(error), 422) from error
    abnormal = [row for row in answers if row.get("result") == "abnormal"]
    if abnormal and str(payload.get("abnormalNote", "")).strip() == "":
        raise AppError("VALIDATION_FAILED", "存在异常项时必须填写异常描述", 422)
    if payload.get("createIssue") and not abnormal:
        raise AppError("VALIDATION_FAILED", "没有异常项不能转问题", 422)
    specs = [
        PhotoSpec(item["mediaId"], item["draftId"], item.get("kind", "scene"), item.get("thumbId"))
        for item in payload.get("photos") or []
    ]
    photo_ids = link_photos(
        session,
        workspace,
        PhotoOwner(
            maintenance_task_id=task.id,
            point_id=task.snapshot.get("pointId"),
            building_id=task.snapshot.get("buildingId"),
        ),
        specs,
    )
    issue = _execute_issue(session, workspace, task, payload)
    execution = {
        "by": workspace.actor.name,
        "byRole": workspace.actor.role,
        "checklist": answers,
        "measures": measures,
        "materials": payload.get("materials", ""),
        "photos": photo_ids,
        "nextDueDate": next_due,
        "note": payload.get("note", ""),
        "abnormalNote": payload.get("abnormalNote", ""),
        "issueId": issue.id if issue is not None else None,
    }
    _record_execution(session, workspace, task, execution)
    return {
        "task": maintenance_task_out(task),
        "issue": issue_out(issue) if issue is not None else None,
        "photos": [
            attachment_out(session, workspace, row)
            for row in _task_attachments(session, workspace, task.id)
        ],
    }


def _task_attachments(session: Session, workspace: Workspace, task_id: str):
    from ...db.models.media import Attachment

    return session.scalars(
        select(Attachment).where(
            Attachment.dataset_id == workspace.dataset_id,
            Attachment.maintenance_task_id == task_id,
        )
    ).all()
