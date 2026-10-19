"""报表共用：筛选条件、范围、数据装载与中文标签。"""

from dataclasses import dataclass
from datetime import UTC, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....db.models.archive import Building, Point
from ....db.models.field import InspectionTask, Issue, MaintenanceTask, WorkOrder
from ....db.models.monitoring import AlarmEvent
from ....domain.monitoring.engine import parse_iso
from ...datasets.core.workspace import Workspace, can_access_building

LOCAL = timezone(timedelta(hours=8))


@dataclass(frozen=True)
class ReportFilters:
    start: str = ""
    end: str = ""
    building_id: str = ""
    point_id: str = ""
    status: str = ""


def local_day(at: str | None) -> str:
    moment = parse_iso(at) if at else None
    if moment is None:
        return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(LOCAL).strftime("%Y-%m-%d")


def fmt(at: str | None) -> str:
    moment = parse_iso(at) if at else None
    if moment is None:
        return ""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(LOCAL).strftime("%Y-%m-%d %H:%M")


def in_range(at: str | None, filters: ReportFilters) -> bool:
    day = local_day(at)
    if not day:
        return False
    if filters.start and day < filters.start:
        return False
    if filters.end and day > filters.end:
        return False
    return True


def completed_by_due(at: str | None, due_date: str | None) -> bool:
    """完成时刻不晚于目标日期当天 23:59:59（本地时区）。"""
    moment = parse_iso(at) if at else None
    if moment is None or not due_date:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    due = parse_iso(f"{due_date}T23:59:59+08:00")
    if due is None:
        return False
    return moment <= due


def scoped(workspace: Workspace, building_id: str | None) -> bool:
    return can_access_building(workspace, building_id)


def repo(session: Session, workspace: Workspace) -> dict:
    points = {
        row.id: row
        for row in session.scalars(select(Point).where(Point.dataset_id == workspace.dataset_id))
    }
    buildings = {
        row.id: row
        for row in session.scalars(
            select(Building).where(Building.dataset_id == workspace.dataset_id)
        )
    }
    return {
        "points": points,
        "buildings": buildings,
        "events": list(
            session.scalars(select(AlarmEvent).where(AlarmEvent.dataset_id == workspace.dataset_id))
        ),
        "issues": list(
            session.scalars(select(Issue).where(Issue.dataset_id == workspace.dataset_id))
        ),
        "orders": list(
            session.scalars(select(WorkOrder).where(WorkOrder.dataset_id == workspace.dataset_id))
        ),
        "tasks": list(
            session.scalars(
                select(MaintenanceTask).where(MaintenanceTask.dataset_id == workspace.dataset_id)
            )
        ),
        "inspection": list(
            session.scalars(
                select(InspectionTask).where(InspectionTask.dataset_id == workspace.dataset_id)
            )
        ),
    }


def event_building(data: dict, event: AlarmEvent) -> str | None:
    point = data["points"].get(event.point_id)
    return point.building_id if point is not None else None


def maintenance_building(task: MaintenanceTask) -> str | None:
    return (task.snapshot or {}).get("buildingId")


def keep_event(data: dict, workspace: Workspace, row: AlarmEvent, filters: ReportFilters) -> bool:
    building_id = event_building(data, row)
    if filters.building_id and building_id != filters.building_id:
        return False
    if filters.point_id and row.point_id != filters.point_id:
        return False
    if filters.status and row.status != filters.status:
        return False
    if not in_range(row.opened_at, filters):
        return False
    return scoped(workspace, building_id)


def keep_issue(data: dict, workspace: Workspace, row: Issue, filters: ReportFilters) -> bool:
    if filters.building_id and row.building_id != filters.building_id:
        return False
    if filters.point_id and row.point_id != filters.point_id:
        return False
    if filters.status and row.status != filters.status:
        return False
    if not in_range(row.created_at, filters):
        return False
    return scoped(workspace, row.building_id)


def keep_order(data: dict, workspace: Workspace, row: WorkOrder, filters: ReportFilters) -> bool:
    point = data["points"].get(row.point_id) if row.point_id else None
    building_id = point.building_id if point is not None else None
    if filters.building_id and building_id != filters.building_id:
        return False
    if filters.point_id and row.point_id != filters.point_id:
        return False
    if filters.status and row.status != filters.status:
        return False
    if not in_range(row.created_at, filters):
        return False
    return scoped(workspace, building_id)


def keep_maintenance(
    data: dict, workspace: Workspace, row: MaintenanceTask, filters: ReportFilters
) -> bool:
    building_id = maintenance_building(row)
    if filters.building_id and building_id != filters.building_id:
        return False
    if filters.point_id and (row.snapshot or {}).get("pointId") != filters.point_id:
        return False
    if filters.status and row.status != filters.status:
        return False
    if not in_range(row.planned_at, filters):
        return False
    return scoped(workspace, building_id)


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


EVENT_LEVEL = {"yellow": "黄色", "orange": "橙色", "red": "红色"}
EVENT_STATUS = {
    "pending": "待处理",
    "handling": "处理中",
    "recovering": "恢复待确认",
    "closed": "已关闭",
}
ISSUE_STATUS = {
    "pending_review": "待审核",
    "repairing": "维修中",
    "investigating": "排查中",
    "pending_recheck": "待复查",
    "observing": "观察中",
    "closed": "已关闭",
}
ORDER_STATUS = {
    "created": "待派工",
    "assigned": "已派工",
    "repairing": "维修中",
    "submitted": "待验收",
    "verified": "已验收",
    "returned": "已退回",
}
SOURCE_LABEL = {
    "sensor": "传感器",
    "report": "人工上报",
    "inspection": "巡检",
    "maintenance": "保养",
}
REVIEW_LABEL = {
    "to_repair": "转维修",
    "to_investigate": "转专业排查",
    "recheck": "安排复查",
    "need_evidence": "退回补充",
    "link_object": "关联已有对象",
    "close_no_fault": "无需处理并关闭",
}
OUTCOME_LABEL = {"recovered": "恢复", "observing": "继续观察", "recurred": "复发"}
TASK_STATUS = {"pending": "待检查", "partial": "部分完成", "checked": "已完成"}
MAINTENANCE_STATUS = {"pending": "待保养", "done": "已完成"}


def point_label(data: dict, point_id: str | None) -> str:
    point = data["points"].get(point_id or "")
    return "" if point is None else f"{point.code} {point.name}"


def building_label(data: dict, building_id: str | None) -> str:
    building = data["buildings"].get(building_id or "")
    return "" if building is None else building.name


def or_none(value: str | None) -> str:
    return "（未填写）" if not str(value or "").strip() else str(value)


def time_or_none(value: str | None) -> str:
    return "（无）" if not value else fmt(value)


__all__ = [
    "EVENT_LEVEL",
    "EVENT_STATUS",
    "ISSUE_STATUS",
    "MAINTENANCE_STATUS",
    "ORDER_STATUS",
    "OUTCOME_LABEL",
    "REVIEW_LABEL",
    "ReportFilters",
    "SOURCE_LABEL",
    "TASK_STATUS",
    "building_label",
    "event_building",
    "fmt",
    "in_range",
    "keep_event",
    "keep_issue",
    "keep_maintenance",
    "keep_order",
    "local_day",
    "maintenance_building",
    "median",
    "or_none",
    "point_label",
    "repo",
    "scoped",
    "time_or_none",
]
