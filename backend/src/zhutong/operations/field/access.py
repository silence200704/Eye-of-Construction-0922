"""现场对象读取：按数据集取行后统一校验目标楼栋范围。"""

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
from ..datasets.core.workspace import Workspace, require_target_building


def get_plan(session: Session, workspace: Workspace, plan_id: str) -> InspectionPlan:
    row = session.get(InspectionPlan, (workspace.dataset_id, plan_id))
    if row is None:
        raise AppError("NOT_FOUND", "巡检计划不存在", 404, {"planId": plan_id})
    require_target_building(workspace, row.building_id, "巡检计划")
    return row


def get_task(session: Session, workspace: Workspace, task_id: str) -> InspectionTask:
    row = session.get(InspectionTask, (workspace.dataset_id, task_id))
    if row is None:
        raise AppError("NOT_FOUND", "巡检任务不存在", 404, {"taskId": task_id})
    require_target_building(workspace, row.building_id, "巡检任务")
    return row


def get_issue(session: Session, workspace: Workspace, issue_id: str) -> Issue:
    row = session.get(Issue, (workspace.dataset_id, issue_id))
    if row is None:
        raise AppError("NOT_FOUND", "问题不存在", 404, {"issueId": issue_id})
    require_target_building(workspace, row.building_id, "问题")
    return row


def _order_building(session: Session, workspace: Workspace, row: WorkOrder) -> str | None:
    if row.point_id:
        point = session.get(Point, (workspace.dataset_id, row.point_id))
        if point is not None:
            return point.building_id
    if row.issue_id:
        issue = session.get(Issue, (workspace.dataset_id, row.issue_id))
        if issue is not None:
            return issue.building_id
    return None


def get_order(session: Session, workspace: Workspace, order_id: str) -> WorkOrder:
    row = session.get(WorkOrder, (workspace.dataset_id, order_id))
    if row is None:
        raise AppError("NOT_FOUND", "工单不存在", 404, {"orderId": order_id})
    require_target_building(workspace, _order_building(session, workspace, row), "工单")
    return row


def get_maintenance_plan(session: Session, workspace: Workspace, plan_id: str) -> MaintenancePlan:
    row = session.get(MaintenancePlan, (workspace.dataset_id, plan_id))
    if row is None:
        raise AppError("NOT_FOUND", "保养计划不存在", 404, {"planId": plan_id})
    require_target_building(workspace, row.building_id, "保养计划")
    return row


def get_maintenance_task(session: Session, workspace: Workspace, task_id: str) -> MaintenanceTask:
    row = session.get(MaintenanceTask, (workspace.dataset_id, task_id))
    if row is None:
        raise AppError("NOT_FOUND", "保养任务不存在", 404, {"taskId": task_id})
    require_target_building(workspace, (row.snapshot or {}).get("buildingId"), "保养任务")
    return row
