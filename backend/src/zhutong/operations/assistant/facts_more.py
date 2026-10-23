"""动态业务事实（续）：趋势、事件追因、队列、问题/工单、试算与案例。"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.models.archive import Point
from ...db.models.field import Issue, WorkOrder
from ...db.models.monitoring import AlarmEvent
from ..datasets.core.record_queries import records_of_point
from ..datasets.core.workspace import Workspace
from .facts import (
    LEVEL_TEXT,
    STATUS_TEXT,
    _freshness,
    _latest_record,
    _local,
    _open_event_of,
    _value_of,
    queried_at,
)
from .resolve import Resolved

ACTION_TEXT = {
    "pending": "待学校安全管理人员确认；确认后进入处理中",
    "handling": "处理中：可转问题、登记处置；恢复待确认后由安全管理人员关闭",
    "recovering": "恢复待确认：需连续有效恢复复测与处置依据，才允许关闭",
    "closed": "已关闭",
}


def _event_rows(session: Session, workspace: Workspace, open_only: bool) -> list[AlarmEvent]:
    rows = session.scalars(select(AlarmEvent).where(AlarmEvent.dataset_id == workspace.dataset_id))
    points = {row.id: row for row in _all_points(session, workspace)}
    visible = [row for row in rows if row.point_id in points]
    if open_only:
        visible = [row for row in visible if row.status != "closed"]
    return sorted(visible, key=lambda row: row.last_trigger_at or "", reverse=True)


def _all_points(session: Session, workspace: Workspace) -> list:
    from ..datasets.core.workspace import can_access_building

    rows = session.scalars(
        select(Point).where(Point.dataset_id == workspace.dataset_id, Point.status == "active")
    )
    return [row for row in rows if can_access_building(workspace, row.building_id)]


def point_trend(session: Session, workspace: Workspace, point, now: datetime) -> dict:
    rows = [row for row in records_of_point(session, workspace, point.id) if row.quality == "valid"]
    rows.sort(key=lambda row: row.sample_time)
    recent = rows[-30:]
    samples = [
        {
            "recordId": row.id,
            "recordNo": row.record_no,
            "sampleTime": row.sample_time,
            "value": next(iter(row.values.values()), None),
        }
        for row in recent
    ]
    unit = recent[-1].unit if recent else ""
    values = [s["value"] for s in samples if isinstance(s["value"], (int, float))]
    facts = [
        {"label": "测点", "value": f"{point.code} {point.name}", "unit": ""},
        {"label": "有效样本", "value": str(len(recent)), "unit": "条"},
    ]
    if values:
        facts.append(
            {"label": "区间最小/最大", "value": f"{min(values):g} ~ {max(values):g}", "unit": unit}
        )
    event = _open_event_of(session, workspace, point.id)
    conclusion = (
        f"{point.name}最近 {len(recent)} 条有效读数已返回"
        f"（最新采样 {_local(recent[-1].sample_time)}）。"
        if recent
        else f"{point.name}暂无有效读数，无法画趋势。"
    )
    if event is not None:
        conclusion += f"该测点存在未关闭事件 {event.event_no}。"
    return {
        "conclusion": conclusion,
        "facts": facts,
        "evidence": [],
        "extras": {"samples": samples, "unit": unit, "queriedAt": queried_at()},
    }


def event_reason(session: Session, workspace: Workspace, event: AlarmEvent) -> dict:
    point = session.get(Point, (event.dataset_id, event.point_id))
    level = LEVEL_TEXT.get(event.level, event.level)
    facts = [
        {"label": "事件", "value": f"{event.event_no}（{level}）", "unit": ""},
        {"label": "状态", "value": STATUS_TEXT.get(event.status, event.status), "unit": ""},
        {
            "label": "测点",
            "value": f"{point.code} {point.name}" if point else event.point_id,
            "unit": "",
        },
        {"label": "触发规则", "value": f"{event.rule_code}", "unit": ""},
    ]
    evidence = []
    for index, item in enumerate(event.evidences or []):
        evidence.append(
            {
                "kind": "record",
                "ref": str(item.get("recordNo") or ""),
                "id": str(item.get("recordId") or ""),
                "detail": (
                    f"证据 {index + 1}：采样 {_local(item.get('sampleTime'))}，"
                    f"触发值 {item.get('triggerValue')}{event.unit}，"
                    f"规则版本 {item.get('ruleVersion')}；{item.get('reason') or ''}"
                ),
            }
        )
    superseded = len(event.superseded_evidences or [])
    if superseded:
        evidence.append(
            {
                "kind": "event",
                "ref": event.event_no,
                "id": event.id,
                "detail": f"已替代证据 {superseded} 条（保留审计）",
            }
        )
    acknowledged = "已确认" if event.acknowledged_at else "未确认"
    facts.append({"label": "确认状态", "value": acknowledged, "unit": ""})
    issue = session.scalar(
        select(Issue).where(Issue.dataset_id == workspace.dataset_id, Issue.event_id == event.id)
    )
    if issue is not None:
        facts.append(
            {"label": "关联问题", "value": f"{issue.issue_no}（{issue.status}）", "unit": ""}
        )
    active_count = len(event.evidences or [])
    conclusion = (
        f"{event.event_no} 因 {event.rule_code} 触发 {level}，共 {active_count} 条活跃证据；"
        f"当前{STATUS_TEXT.get(event.status, event.status)}，{acknowledged}。"
    )
    return {
        "conclusion": conclusion,
        "facts": facts,
        "evidence": evidence,
        "extras": {"timeline": (event.timeline or [])[-8:], "queriedAt": queried_at()},
    }


def open_events(session: Session, workspace: Workspace) -> dict:
    rows = _event_rows(session, workspace, open_only=True)
    by_level: dict[str, list[AlarmEvent]] = {}
    for row in rows:
        by_level.setdefault(row.level, []).append(row)
    facts = [
        {"label": "未关闭事件", "value": str(len(rows)), "unit": "条"},
        {
            "label": "红色 / 橙色 / 黄色",
            "value": (
                f"{len(by_level.get('red', []))} / {len(by_level.get('orange', []))}"
                f" / {len(by_level.get('yellow', []))}"
            ),
            "unit": "条",
        },
    ]
    evidence = [
        {
            "kind": "event",
            "ref": row.event_no,
            "id": row.id,
            "detail": (
                f"{LEVEL_TEXT.get(row.level, row.level)}，"
                f"{STATUS_TEXT.get(row.status, row.status)}，最近触发 {_local(row.last_trigger_at)}"
            ),
        }
        for row in rows[:8]
    ]
    conclusion = f"当前未关闭预警事件 {len(rows)} 条。" if rows else "当前没有未关闭的预警事件。"
    return {
        "conclusion": conclusion,
        "facts": facts,
        "evidence": evidence,
        "extras": {"queriedAt": queried_at()},
    }


def campus_overview(session: Session, workspace: Workspace) -> dict:
    from ...db.models.archive import Building, Device

    points = _all_points(session, workspace)
    point_ids = {row.id for row in points}
    buildings = session.scalars(
        select(Building).where(
            Building.dataset_id == workspace.dataset_id, Building.status == "active"
        )
    )
    visible_buildings = [row for row in buildings if row.id in {p.building_id for p in points}]
    devices = session.scalars(
        select(Device).where(Device.dataset_id == workspace.dataset_id, Device.status == "active")
    )
    visible_devices = [row for row in devices if row.point_id in point_ids]
    open = _event_rows(session, workspace, open_only=True)
    issues = session.scalars(select(Issue).where(Issue.dataset_id == workspace.dataset_id))
    open_issues = [
        row
        for row in issues
        if row.status != "closed" and (row.point_id is None or row.point_id in point_ids)
    ]
    orders = session.scalars(select(WorkOrder).where(WorkOrder.dataset_id == workspace.dataset_id))
    open_orders = [
        row
        for row in orders
        if row.status not in {"verified"} and (row.point_id is None or row.point_id in point_ids)
    ]
    record_count = sum(
        len([row for row in records_of_point(session, workspace, pid) if row.quality == "valid"])
        for pid in list(point_ids)[:20]
    )
    facts = [
        {
            "label": "在册楼栋 / 测点 / 设备",
            "value": f"{len(visible_buildings)} / {len(points)} / {len(visible_devices)}",
            "unit": "",
        },
        {"label": "有效监测记录", "value": str(record_count), "unit": "条"},
        {
            "label": "未关闭事件 / 问题 / 工单",
            "value": f"{len(open)} / {len(open_issues)} / {len(open_orders)}",
            "unit": "条",
        },
    ]
    conclusion = (
        f"全校在册 {len(visible_buildings)} 栋楼、{len(points)} 个测点；未关闭事件 {len(open)} 条、"
        f"问题 {len(open_issues)} 条、工单 {len(open_orders)} 张。"
    )
    return {
        "conclusion": conclusion,
        "facts": facts,
        "evidence": [],
        "extras": {"queriedAt": queried_at()},
    }


def issue_status(
    session: Session, workspace: Workspace, issue: Issue, order: WorkOrder | None
) -> dict:
    facts = [
        {"label": "问题", "value": f"{issue.issue_no}（{issue.anomaly_type}）", "unit": ""},
        {"label": "状态", "value": issue.status, "unit": ""},
        {"label": "来源", "value": issue.source, "unit": ""},
    ]
    if issue.review_action:
        facts.append(
            {
                "label": "审核出口",
                "value": f"{issue.review_action}／{issue.review_category}",
                "unit": "",
            }
        )
    evidence = [
        {
            "kind": "issue",
            "ref": issue.issue_no,
            "id": issue.id,
            "detail": str(row.get("action")) + "：" + str(row.get("detail", "")),
        }
        for row in (issue.timeline or [])[-6:]
    ]
    if order is not None:
        facts.append({"label": "工单", "value": f"{order.order_no}（{order.status}）", "unit": ""})
        facts.append({"label": "维修人", "value": order.assignee or "待派工", "unit": ""})
    rounds = issue.rechecks or []
    if rounds:
        last = rounds[-1]
        outcome = last.get("outcome") or "待复查"
        if last.get("invalidatedAt"):
            outcome = "已失效（新维修周期）"
        facts.append(
            {"label": "复查轮次", "value": f"{len(rounds)} 轮，最近：{outcome}", "unit": ""}
        )
    conclusion = f"问题 {issue.issue_no} 当前为「{issue.status}」"
    conclusion += _next_action_hint(issue.status)
    return {
        "conclusion": conclusion,
        "facts": facts,
        "evidence": evidence,
        "extras": {"queriedAt": queried_at()},
    }


def _next_action_hint(status: str) -> str:
    hints = {
        "pending_review": "；下一步由学校安全管理人员按六种出口审核。",
        "repairing": "；工单维修完成后提交验收，验收通过只进入待复查，不直接关闭问题。",
        "investigating": "；由专业排查人员给出结论后继续审核。",
        "pending_recheck": "；由学校安全管理人员登记复查并给出结论。",
        "observing": "；观察期到点后登记下一轮复查结论。",
        "closed": "。该问题已关闭；如需继续处理请新建问题并关联本条。",
    }
    return hints.get(status, "。")


def reading_recovery(
    session: Session, workspace: Workspace, resolved: Resolved, event: AlarmEvent, now: datetime
) -> dict:
    point_id = event.point_id
    record = _latest_record(session, workspace, point_id)
    facts = [
        {"label": "事件", "value": event.event_no, "unit": ""},
        {"label": "事件状态", "value": STATUS_TEXT.get(event.status, event.status), "unit": ""},
    ]
    if record is None:
        return {
            "conclusion": "该测点还没有有效读数，无法判断恢复；请先录入恢复复测记录。",
            "facts": facts,
            "evidence": [],
            "extras": {"queriedAt": queried_at()},
        }
    value, unit = _value_of(record)
    freshness, freshness_label = _freshness(record.sample_time, now)
    facts.append({"label": "最新有效读数", "value": value, "unit": unit})
    thresholds = (event.evidences or [{}])[-1]
    facts.append(
        {
            "label": "对照事件阈值",
            "value": f"{thresholds.get('triggerValue')}{event.unit}",
            "unit": "",
        }
    )
    conclusion = (
        f"最新有效读数 {value}{unit}，{freshness_label}。是否恢复以阶段 4 判定为准："
        f"事件当前为「{STATUS_TEXT.get(event.status, event.status)}」，"
        "恢复待确认需连续复测满足条件后由人确认关闭。"
    )
    evidence = [
        {
            "kind": "record",
            "ref": record.record_no,
            "id": record.id,
            "detail": f"采样 {_local(record.sample_time)}",
        }
    ]
    return {
        "conclusion": conclusion,
        "facts": facts,
        "evidence": evidence,
        "extras": {"queriedAt": queried_at()},
    }
