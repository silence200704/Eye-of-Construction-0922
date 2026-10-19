"""三项管理指标的数据库重算，口径与前端 core/metrics/indicators.ts 一致。"""

from sqlalchemy.orm import Session

from ....db.models.field import Issue
from ....db.models.monitoring import AlarmEvent
from ....domain.monitoring.engine import parse_iso
from ...datasets.core.workspace import Workspace
from .types import (
    ReportFilters,
    completed_by_due,
    in_range,
    keep_event,
    maintenance_building,
    median,
    repo,
    scoped,
)


def _first_response(event: AlarmEvent, issue_times: dict[str, list[str]]) -> str | None:
    candidates = [*issue_times.get(event.id, [])]
    if event.acknowledged_at:
        candidates.append(event.acknowledged_at)
    return min(candidates) if candidates else None


def _response_indicator(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    issue_times: dict[str, list[str]] = {}
    for issue in data["issues"]:
        if issue.event_id:
            issue_times.setdefault(issue.event_id, []).append(issue.created_at)
    durations: list[float] = []
    silent: list[str] = []
    for event in data["events"]:
        if not keep_event(data, workspace, event, filters):
            continue
        response = _first_response(event, issue_times)
        if response is None:
            silent.append(event.event_no)
            continue
        opened = parse_iso(event.opened_at)
        answered = parse_iso(response)
        if opened is None or answered is None:
            continue
        durations.append((answered - opened).total_seconds() / 3600)
    total = sum(durations)
    stability = median(durations)
    return {
        "key": "response",
        "name": "预警响应时长",
        "definition": (
            "事件产生到首次响应的平均时长；首次响应取人工确认与转出问题中更早的时刻。"
            "时间范围按事件产生时间。"
        ),
        "kind": "hours",
        "numerator": {
            "label": "已响应事件的响应时长合计（小时）",
            "value": round(total, 1),
        },
        "denominator": {"label": "范围内已响应事件数", "value": len(durations)},
        "value": None if not durations else total / len(durations),
        "extra": "" if not durations else f"中位数 {stability:.1f} 小时（稳健参考）",
        "exclusions": [
            {
                "label": "未响应事件（既未确认、也没有转出问题）：无法计算响应时长，不进分母",
                "count": len(silent),
                "samples": silent[:8],
            }
        ],
    }


def _closed_at(issue: Issue) -> str | None:
    entries = [row for row in issue.timeline or [] if "关闭" in str(row.get("action", ""))]
    if entries:
        return str(entries[-1].get("at") or "")
    return issue.updated_at if issue.status == "closed" else None


def _closure_indicator(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    on_time: list[str] = []
    late: list[str] = []
    no_recheck: list[str] = []
    open_rows: list[str] = []
    for issue in data["issues"]:
        if not scoped(workspace, issue.building_id):
            continue
        if filters.building_id and issue.building_id != filters.building_id:
            continue
        if filters.point_id and issue.point_id != filters.point_id:
            continue
        closed = _closed_at(issue)
        if not closed:
            if in_range(issue.created_at, filters):
                open_rows.append(issue.issue_no)
            continue
        if not in_range(closed, filters):
            continue
        rounds = issue.rechecks or []
        last = rounds[-1] if rounds else None
        if last is None or last.get("outcome") is None:
            no_recheck.append(issue.issue_no)
            continue
        if completed_by_due(closed, last.get("dueDate")):
            on_time.append(issue.issue_no)
        else:
            late.append(issue.issue_no)
    denominator = len(on_time) + len(late)
    return {
        "key": "closure",
        "name": "问题按期闭环率",
        "definition": (
            "在最后登记的复查目标日期（含当天）之前关闭的问题占比。时间范围按问题关闭时间。"
        ),
        "kind": "ratio",
        "numerator": {"label": "按期关闭的问题数", "value": len(on_time)},
        "denominator": {
            "label": "范围内已关闭且登记过复查的问题数",
            "value": denominator,
        },
        "value": None if denominator == 0 else len(on_time) / denominator,
        "extra": "" if not late else f"逾期关闭 {len(late)} 条：{'、'.join(late[:8])}",
        "exclusions": [
            {
                "label": "已关闭但从未登记复查：没有目标日期，判定不了是否按期，不进分子分母",
                "count": len(no_recheck),
                "samples": no_recheck[:8],
            },
            {
                "label": "范围内仍未关闭的问题（另列未闭环清单）",
                "count": len(open_rows),
                "samples": open_rows[:8],
            },
        ],
    }


def _recheck_stats(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    on_time = late = 0
    pending: list[str] = []
    for issue in data["issues"]:
        if not scoped(workspace, issue.building_id):
            continue
        if filters.building_id and issue.building_id != filters.building_id:
            continue
        if filters.point_id and issue.point_id != filters.point_id:
            continue
        for index, row in enumerate(issue.rechecks or []):
            if row.get("invalidatedAt"):
                continue
            label = f"{issue.issue_no} 第 {index + 1} 轮"
            outcome_at = row.get("outcomeAt")
            if not outcome_at:
                if in_range(row.get("at"), filters):
                    pending.append(label)
                continue
            if not in_range(outcome_at, filters):
                continue
            if completed_by_due(outcome_at, row.get("dueDate")):
                on_time += 1
            else:
                late += 1
    return {"on_time": on_time, "late": late, "pending": pending}


def _maintenance_stats(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    on_time = late = 0
    unfinished: list[str] = []
    for task in data["tasks"]:
        building_id = maintenance_building(task)
        if not scoped(workspace, building_id):
            continue
        if filters.building_id and building_id != filters.building_id:
            continue
        if filters.point_id and (task.snapshot or {}).get("pointId") != filters.point_id:
            continue
        label = f"{task.task_no}（{(task.snapshot or {}).get('deviceName', '')}）"
        execution = task.execution
        if task.status != "done" or not execution:
            if in_range(task.planned_at, filters):
                unfinished.append(label)
            continue
        executed = execution.get("at")
        if not in_range(executed, filters):
            continue
        if task.due_at and executed <= task.due_at:
            on_time += 1
        else:
            late += 1
    return {"on_time": on_time, "late": late, "unfinished": unfinished}


def _periodic_indicator(data: dict, workspace: Workspace, filters: ReportFilters) -> dict:
    recheck = _recheck_stats(data, workspace, filters)
    maintenance = _maintenance_stats(data, workspace, filters)
    on_time = recheck["on_time"] + maintenance["on_time"]
    recheck_total = recheck["on_time"] + recheck["late"]
    maintenance_total = maintenance["on_time"] + maintenance["late"]
    denominator = on_time + recheck["late"] + maintenance["late"]
    extra = (
        f"复查 {recheck['on_time']}/{recheck_total}"
        if recheck_total
        else "复查：暂无已出结论的轮次"
    )
    extra += (
        f"；保养 {maintenance['on_time']}/{maintenance_total}"
        if maintenance_total
        else "；保养：暂无已完成任务"
    )
    return {
        "key": "periodic",
        "name": "复查 / 保养按期完成率",
        "definition": (
            "在目标日期（复查轮次目标日期、保养计划执行日）当天 23:59:59 前完成的占比。"
            "复查按结论时间、保养按执行时间，均取本地日。"
        ),
        "kind": "ratio",
        "numerator": {"label": "按期完成的复查轮次 + 保养任务数", "value": on_time},
        "denominator": {
            "label": "范围内已出结论的复查轮次 + 已完成保养任务数",
            "value": denominator,
        },
        "value": None if denominator == 0 else on_time / denominator,
        "extra": extra,
        "exclusions": [
            {
                "label": "尚未给出结论的复查轮次（逾期与否另行提醒，不计入按期率）",
                "count": len(recheck["pending"]),
                "samples": recheck["pending"][:8],
            },
            {
                "label": "范围内未完成的保养任务（另列逾期清单）",
                "count": len(maintenance["unfinished"]),
                "samples": maintenance["unfinished"][:8],
            },
        ],
    }


def indicators(session: Session, workspace: Workspace, filters: ReportFilters) -> dict:
    data = repo(session, workspace)
    if filters.building_id and not scoped(workspace, filters.building_id):
        from ....core.errors import AppError

        raise AppError("SCOPE_FORBIDDEN", "当前身份无权访问该楼栋", 403)
    return {
        "from": filters.start,
        "to": filters.end,
        "buildingId": filters.building_id,
        "pointId": filters.point_id,
        "indicators": [
            _response_indicator(data, workspace, filters),
            _closure_indicator(data, workspace, filters),
            _periodic_indicator(data, workspace, filters),
        ],
    }
