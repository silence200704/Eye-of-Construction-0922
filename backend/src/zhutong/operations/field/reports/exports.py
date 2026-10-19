"""明细导出：按筛选条件从数据库行生成中文表头与 CSV 行。"""

from sqlalchemy.orm import Session

from ....core.errors import AppError
from ...datasets.core.workspace import Workspace
from .types import (
    EVENT_LEVEL,
    EVENT_STATUS,
    ISSUE_STATUS,
    MAINTENANCE_STATUS,
    ORDER_STATUS,
    OUTCOME_LABEL,
    REVIEW_LABEL,
    SOURCE_LABEL,
    TASK_STATUS,
    ReportFilters,
    building_label,
    fmt,
    in_range,
    keep_event,
    keep_issue,
    keep_maintenance,
    keep_order,
    point_label,
    repo,
    scoped,
)


def _event_export(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    header = [
        "事件编号",
        "楼栋",
        "测点",
        "规则",
        "当前等级",
        "最高等级",
        "状态",
        "产生时间",
        "最近触发时间",
        "触发值",
        "活跃证据数",
        "确认时间",
        "关闭时间",
        "关闭依据",
    ]
    rows: list[list[str]] = []
    for event in data["events"]:
        if not keep_event(data, workspace, event, filters):
            continue
        building_id = data["points"].get(event.point_id)
        rows.append(
            [
                event.event_no,
                building_label(data, building_id.building_id if building_id is not None else None),
                point_label(data, event.point_id),
                event.rule_code,
                EVENT_LEVEL.get(event.level, event.level),
                EVENT_LEVEL.get(event.peak_level, event.peak_level),
                EVENT_STATUS.get(event.status, event.status),
                fmt(event.opened_at),
                fmt(event.last_trigger_at),
                f"{event.last_trigger_value:g}{event.unit}",
                str(len(event.evidences or [])),
                fmt(event.acknowledged_at),
                fmt(event.closed_at),
                event.close_basis,
            ]
        )
    return {"header": header, "rows": rows, "count": len(rows)}


def _issue_export(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    header = [
        "问题编号",
        "楼栋",
        "测点",
        "来源",
        "异常类型",
        "状态",
        "描述",
        "审核出口",
        "审核分类",
        "审核时间",
        "关联工单",
        "登记复查轮次",
        "最近目标日期",
    ]
    rows: list[list[str]] = []
    for issue in data["issues"]:
        if not keep_issue(data, workspace, issue, filters):
            continue
        rounds = issue.rechecks or []
        last = rounds[-1] if rounds else {}
        rows.append(
            [
                issue.issue_no,
                building_label(data, issue.building_id),
                point_label(data, issue.point_id),
                SOURCE_LABEL.get(issue.source, issue.source),
                issue.anomaly_type,
                ISSUE_STATUS.get(issue.status, issue.status),
                issue.description,
                REVIEW_LABEL.get(issue.review_action or "", ""),
                issue.review_category,
                fmt(issue.reviewed_at),
                " / ".join(issue.work_order_ids or []),
                str(len(rounds)),
                str(last.get("dueDate") or ""),
            ]
        )
    return {"header": header, "rows": rows, "count": len(rows)}


def _order_export(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    header = [
        "工单编号",
        "来源",
        "测点",
        "状态",
        "维修人",
        "派工时间",
        "提交完工时间",
        "维修措施",
        "材料",
        "完工照片数",
        "验收次数",
        "最近验收结论",
    ]
    rows: list[list[str]] = []
    for order in data["orders"]:
        if not keep_order(data, workspace, order, filters):
            continue
        reviews = order.reviews or []
        last = reviews[-1] if reviews else {}
        conclusion = ""
        if last:
            conclusion = ("验收通过" if last.get("action") == "verify" else "验收退回") + (
                "（合格）" if last.get("result") == "pass" else "（不合格）"
            )
        rows.append(
            [
                order.order_no,
                order.origin,
                point_label(data, order.point_id),
                ORDER_STATUS.get(order.status, order.status),
                order.assignee,
                fmt(order.assigned_at),
                fmt(order.submitted_at),
                order.measures,
                order.materials,
                str(len(order.photos or [])),
                str(len(reviews)),
                conclusion,
            ]
        )
    return {"header": header, "rows": rows, "count": len(rows)}


def _maintenance_export(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    header = [
        "任务编号",
        "计划",
        "设备",
        "计划执行时间",
        "当日截止",
        "状态",
        "执行时间",
        "执行人",
        "维护措施",
        "材料",
        "现场照片数",
        "下次保养日期",
        "异常项数",
    ]
    rows: list[list[str]] = []
    for task in data["tasks"]:
        if not keep_maintenance(data, workspace, task, filters):
            continue
        snapshot = task.snapshot or {}
        execution = task.execution or {}
        abnormal = [
            row for row in execution.get("checklist") or [] if row.get("result") == "abnormal"
        ]
        rows.append(
            [
                task.task_no,
                str(snapshot.get("planName") or ""),
                str(snapshot.get("deviceName") or ""),
                fmt(task.planned_at),
                fmt(task.due_at),
                MAINTENANCE_STATUS.get(task.status, task.status),
                fmt(execution.get("at")),
                str(execution.get("by") or ""),
                str(execution.get("measures") or ""),
                str(execution.get("materials") or ""),
                str(len(execution.get("photos") or [])),
                str(execution.get("nextDueDate") or ""),
                str(len(abnormal)),
            ]
        )
    return {"header": header, "rows": rows, "count": len(rows)}


def _task_export(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    header = [
        "任务编号",
        "计划",
        "楼栋",
        "计划执行时间",
        "当日截止",
        "状态",
        "已完成点位/总点位",
        "关联问题数",
    ]
    rows: list[list[str]] = []
    for task in data["inspection"]:
        if filters.building_id and task.building_id != filters.building_id:
            continue
        if not in_range(task.planned_at, filters):
            continue
        if not scoped(workspace, task.building_id):
            continue
        results = task.results or []
        completed = sum(1 for row in results if row.get("status") == "completed")
        rows.append(
            [
                task.task_no,
                str((task.plan_snapshot or {}).get("planName") or ""),
                building_label(data, task.building_id),
                fmt(task.planned_at),
                fmt(task.due_at),
                TASK_STATUS.get(task.status, task.status),
                f"{completed}/{len(results)}",
                str(len(task.issue_ids or [])),
            ]
        )
    return {"header": header, "rows": rows, "count": len(rows)}


def _recheck_export(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    header = [
        "问题编号",
        "楼栋",
        "复查事项",
        "责任人",
        "目标日期",
        "登记时间",
        "结论",
        "结论时间",
        "结论依据",
    ]
    rows: list[list[str]] = []
    for issue in data["issues"]:
        if not scoped(workspace, issue.building_id):
            continue
        if filters.building_id and issue.building_id != filters.building_id:
            continue
        if filters.point_id and issue.point_id != filters.point_id:
            continue
        for round_row in issue.rechecks or []:
            if not in_range(round_row.get("at"), filters) and not in_range(
                round_row.get("outcomeAt"), filters
            ):
                continue
            rows.append(
                [
                    issue.issue_no,
                    building_label(data, issue.building_id),
                    str(round_row.get("subject") or ""),
                    str(round_row.get("owner") or ""),
                    str(round_row.get("dueDate") or ""),
                    fmt(round_row.get("at")),
                    OUTCOME_LABEL.get(round_row.get("outcome") or "", "尚未提交"),
                    fmt(round_row.get("outcomeAt")),
                    str(round_row.get("outcomeNote") or ""),
                ]
            )
    return {"header": header, "rows": rows, "count": len(rows)}


EXPORTERS = {
    "events": _event_export,
    "issues": _issue_export,
    "orders": _order_export,
    "maintenance": _maintenance_export,
    "tasks": _task_export,
    "rechecks": _recheck_export,
}


def export_rows(session: Session, workspace: Workspace, kind: str, filters: ReportFilters) -> dict:
    exporter = EXPORTERS.get(kind)
    if exporter is None:
        raise AppError("VALIDATION_FAILED", "未知的导出类型", 422)
    data = repo(session, workspace)
    result = exporter(data, workspace, filters)
    return {
        "kind": kind,
        **result,
        "from": filters.start,
        "to": filters.end,
    }
