"""巡检计划、周期任务、到点与逐点检查。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Building, Floor, Point
from ...db.models.field import InspectionPlan, InspectionTask
from ...domain.inspection import tasks as task_rules
from ...domain.inspection.schedule import end_of_day, planned_at, valid_day
from ...operations.identity_types import ROLES
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
    get_plan,
    next_task_no,
    plan_out,
    task_out,
)

PLAN_ROLES = {"safety", "device"}
GENERATE_ROLES = {"safety", "property", "device"}


def _validate_plan(session: Session, workspace: Workspace, payload: dict) -> None:
    building = session.get(Building, (workspace.dataset_id, payload.get("buildingId", "")))
    if building is None or building.status != "active":
        raise AppError("NOT_FOUND", "所属楼栋不存在或已归档", 404)
    require_building(workspace, building.id)
    floor_ids = payload.get("floorIds") or []
    point_ids = payload.get("pointIds") or []
    if not floor_ids:
        raise AppError("VALIDATION_FAILED", "至少要选择一个楼层", 422)
    if not point_ids:
        raise AppError("VALIDATION_FAILED", "至少要选择一个必查点", 422)
    floors = {
        row.id: row
        for row in session.scalars(
            select(Floor).where(Floor.dataset_id == workspace.dataset_id, Floor.id.in_(floor_ids))
        )
    }
    for floor_id in floor_ids:
        floor = floors.get(floor_id)
        if floor is None or floor.building_id != building.id or floor.status != "active":
            raise AppError("VALIDATION_FAILED", f"楼层 {floor_id} 不属于该楼栋或已归档", 422)
    for point_id in point_ids:
        point = session.get(Point, (workspace.dataset_id, point_id))
        if point is None:
            raise AppError("VALIDATION_FAILED", f"必查点 {point_id} 不存在", 422)
        if point.status != "active":
            raise AppError("VALIDATION_FAILED", f"必查点 {point.code} 已归档，不能排进新计划", 422)
        if point.building_id != building.id or point.floor_id not in floor_ids:
            raise AppError("VALIDATION_FAILED", f"必查点 {point.code} 不在所选楼栋/楼层范围内", 422)
    cycle = payload.get("cycle") or {}
    if int(cycle.get("interval", 0)) < 1:
        raise AppError("VALIDATION_FAILED", "周期间隔至少为 1", 422)
    if not valid_day(str(payload.get("startDate", ""))):
        raise AppError("VALIDATION_FAILED", "开始日期不是合法日期", 422)
    end = payload.get("endDate")
    if end not in (None, "") and not valid_day(str(end)):
        raise AppError("VALIDATION_FAILED", "结束日期不是合法日期", 422)
    if end not in (None, "") and str(end) < str(payload.get("startDate", "")):
        raise AppError("VALIDATION_FAILED", "结束日期不能早于开始日期", 422)
    if payload.get("executorRole") not in ROLES:
        raise AppError("VALIDATION_FAILED", "执行角色无效", 422)


def save_plan(
    session: Session,
    workspace: Workspace,
    payload: dict,
    plan_id: str | None,
    expected_rev: int | None,
) -> dict:
    require_role(workspace, PLAN_ROLES, "巡检计划写入")
    _validate_plan(session, workspace, payload)
    at = now_iso()
    if plan_id is None:
        row = InspectionPlan(
            dataset_id=workspace.dataset_id,
            id=uid("plan"),
            code="",
            name=payload["name"].strip(),
            kind=payload.get("kind", "patrol"),
            building_id=payload["buildingId"],
            floor_ids=payload.get("floorIds") or [],
            point_ids=payload.get("pointIds") or [],
            cycle=payload.get("cycle") or {},
            start_date=payload["startDate"],
            end_date=payload.get("endDate") or None,
            owner=payload.get("owner", ""),
            executor_role=payload["executorRole"],
            checklist=payload.get("checklist") or [],
            enabled=bool(payload.get("enabled", True)),
            remark=payload.get("remark", ""),
            created_at=at,
            created_by=workspace.actor.name,
            updated_at=at,
            updated_by=workspace.actor.name,
        )
        # 编号在事务内分配
        from ..datasets.core.workspace import day_key, next_number

        row.code = next_number(
            session,
            InspectionPlan,
            InspectionPlan.code,
            workspace.dataset_id,
            f"PLAN-{day_key(at).replace('-', '')}-",
        )
        session.add(row)
        action = "create"
    else:
        row = get_plan(session, workspace, plan_id)
        require_revision(expected_rev, row)
        row.name = payload["name"].strip()
        row.kind = payload.get("kind", row.kind)
        row.building_id = payload["buildingId"]
        row.floor_ids = payload.get("floorIds") or []
        row.point_ids = payload.get("pointIds") or []
        row.cycle = payload.get("cycle") or {}
        row.start_date = payload["startDate"]
        row.end_date = payload.get("endDate") or None
        row.owner = payload.get("owner", "")
        row.executor_role = payload["executorRole"]
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
            summary=f"{'新建' if action == 'create' else '修改'}巡检计划 {row.code}",
            reason=f"必查点 {len(row.point_ids)} 个；执行角色 {row.executor_role}",
            at=at,
        ),
    )
    return plan_out(row)


def set_plan_enabled(
    session: Session, workspace: Workspace, plan_id: str, enabled: bool, expected_rev: int | None
) -> dict:
    require_role(workspace, PLAN_ROLES, "巡检计划启停")
    row = get_plan(session, workspace, plan_id)
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
            summary=f"{'启用' if enabled else '停用'}巡检计划 {row.code}",
            reason="停用后不再生成新任务，既有任务保留" if not enabled else "按周期继续生成任务",
            at=at,
        ),
    )
    return plan_out(row)


def list_plans(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(InspectionPlan).where(InspectionPlan.dataset_id == workspace.dataset_id)
    )
    return [plan_out(row) for row in rows]


def _snapshot(plan: InspectionPlan) -> dict:
    return {
        "planCode": plan.code,
        "planName": plan.name,
        "executorRole": plan.executor_role,
        "buildingId": plan.building_id,
        "floorIds": list(plan.floor_ids or []),
        "pointIds": list(plan.point_ids or []),
        "checklist": [{**item} for item in plan.checklist or []],
    }


def generate_tasks(session: Session, workspace: Workspace, day: str) -> dict:
    require_role(workspace, GENERATE_ROLES, "生成巡检任务")
    if not valid_day(day):
        raise AppError("VALIDATION_FAILED", "日期不是合法日期", 422)
    plans = session.scalars(
        select(InspectionPlan).where(
            InspectionPlan.dataset_id == workspace.dataset_id,
            InspectionPlan.enabled.is_(True),
        )
    )
    created: list[dict] = []
    skipped = 0
    at = now_iso()
    for plan in plans:
        if not can_access_building(workspace, plan.building_id):
            continue
        planned = planned_at(
            {
                "startDate": plan.start_date,
                "endDate": plan.end_date,
                "cycle": plan.cycle or {},
            },
            day,
        )
        if planned is None or not plan.point_ids:
            continue
        key = f"{plan.id}@{planned}"
        if session.get(InspectionTask, (workspace.dataset_id, key)) is not None:
            skipped += 1
            continue
        snapshot = _snapshot(plan)
        task = InspectionTask(
            dataset_id=workspace.dataset_id,
            id=key,
            task_no=next_task_no(session, workspace, planned),
            plan_id=plan.id,
            building_id=plan.building_id,
            plan_snapshot=snapshot,
            planned_at=planned,
            due_at=end_of_day(day),
            status="pending",
            results=task_rules.initial_results(snapshot),
            issue_ids=[],
            created_at=at,
            created_by=workspace.actor.name,
            updated_at=at,
            updated_by=workspace.actor.name,
        )
        session.add(task)
        session.flush()
        created.append(task_out(task))
        write_audit(
            session,
            workspace,
            AuditEntry(
                action="create",
                object_type="system",
                object_id=task.id,
                object_label=f"{task.task_no} {plan.name}",
                summary=f"按 {plan.code} 生成任务 {task.task_no}",
                reason=(
                    f"唯一键：{task.id}；执行角色：{plan.executor_role}；"
                    f"必查点 {len(plan.point_ids)} 个"
                ),
                at=at,
            ),
        )
    return {"created": created, "skipped": skipped}
