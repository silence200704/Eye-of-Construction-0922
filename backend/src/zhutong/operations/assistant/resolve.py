"""对象解析：把问句线索与上下文绑定到数据集内的真实对象 ID。

优先级（S7-04）：本轮显式对象 > 页面上下文 > 上一轮对象 > 问句编号线索。
同名或多项命中返回候选（need_choice），不存在或越权返回 not_found，绝不猜。
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.models.archive import Building, Floor, Point
from ...db.models.field import Issue, WorkOrder
from ...db.models.monitoring import AlarmEvent
from ..datasets.core.workspace import Workspace, can_access_building
from .parse import has_point_clue


@dataclass
class Resolved:
    point_id: str | None = None
    event_id: str | None = None
    issue_id: str | None = None
    work_order_id: str | None = None
    building_id: str | None = None
    explicit: bool = False
    status: str = "resolved"
    conclusion: str = ""
    candidates: list[dict] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)


def _in_scope(workspace: Workspace, building_id: str | None) -> bool:
    return can_access_building(workspace, building_id)


def _point_out(row: Point) -> dict:
    return {"id": row.id, "label": f"{row.code} {row.name}", "detail": ""}


def find_point(session: Session, workspace: Workspace, point_id: str | None) -> Point | None:
    if not point_id:
        return None
    row = session.get(Point, (workspace.dataset_id, point_id))
    if row is None or row.status != "active" or not _in_scope(workspace, row.building_id):
        return None
    return row


def find_event(session: Session, workspace: Workspace, event_id: str | None) -> AlarmEvent | None:
    if not event_id:
        return None
    row = session.get(AlarmEvent, (workspace.dataset_id, event_id))
    if row is None:
        return None
    point = session.get(Point, (workspace.dataset_id, row.point_id))
    if point is None or not _in_scope(workspace, point.building_id):
        return None
    return row


def find_issue(session: Session, workspace: Workspace, issue_id: str | None) -> Issue | None:
    if not issue_id:
        return None
    row = session.get(Issue, (workspace.dataset_id, issue_id))
    if row is None or not _in_scope(workspace, row.building_id):
        return None
    return row


def find_order(session: Session, workspace: Workspace, order_id: str | None) -> WorkOrder | None:
    if not order_id:
        return None
    row = session.get(WorkOrder, (workspace.dataset_id, order_id))
    if row is None:
        return None
    building_id = None
    if row.point_id:
        point = session.get(Point, (workspace.dataset_id, row.point_id))
        building_id = point.building_id if point else None
    if not _in_scope(workspace, building_id):
        return None
    return row


def _by_code(session: Session, workspace: Workspace, code: str) -> list[Point]:
    rows = session.scalars(
        select(Point).where(
            Point.dataset_id == workspace.dataset_id,
            Point.status == "active",
        )
    )
    return [
        row
        for row in rows
        if row.code.lower() == code.lower() and _in_scope(workspace, row.building_id)
    ]


def _by_building(session: Session, workspace: Workspace, ref: str) -> list[Point]:
    buildings = session.scalars(
        select(Building).where(
            Building.dataset_id == workspace.dataset_id, Building.status == "active"
        )
    )
    matched = [
        row
        for row in buildings
        if row.code.lower() == ref.removesuffix("的").lower() or row.name == ref.removesuffix("的")
    ]
    matched = [row for row in matched if _in_scope(workspace, row.id)]
    if not matched:
        return []
    points = session.scalars(
        select(Point).where(Point.dataset_id == workspace.dataset_id, Point.status == "active")
    )
    return [row for row in points if row.building_id in {b.id for b in matched}]


def _by_metric(session: Session, workspace: Workspace, metric: str) -> list[Point]:
    points = session.scalars(
        select(Point).where(Point.dataset_id == workspace.dataset_id, Point.status == "active")
    )
    return [row for row in points if row.metric == metric and _in_scope(workspace, row.building_id)]


def _filter_clues(
    session: Session, workspace: Workspace, matched: list[Point], entities: dict
) -> list[Point]:
    """楼栋、楼层、指标共同约束候选；任何显式线索不匹配都不能退回全库。"""
    refs = entities["buildingRefs"]
    if refs:
        building_points = []
        for ref in refs:
            building_points.extend(_by_building(session, workspace, ref))
        allowed = {row.building_id for row in building_points}
        matched = [row for row in matched if row.building_id in allowed]
    floor_number = entities["floorNumber"]
    if floor_number is not None and matched:
        floor_ids = {
            row.id
            for row in session.scalars(
                select(Floor).where(
                    Floor.dataset_id == workspace.dataset_id,
                    Floor.floor_no == floor_number,
                )
            )
        }
        matched = [row for row in matched if row.floor_id in floor_ids]
    return matched


def _by_event_no(session: Session, workspace: Workspace, event_no: str) -> AlarmEvent | None:
    rows = session.scalars(select(AlarmEvent).where(AlarmEvent.dataset_id == workspace.dataset_id))
    for row in rows:
        if row.event_no.upper() == event_no.upper():
            point = session.get(Point, (workspace.dataset_id, row.point_id))
            if point is not None and _in_scope(workspace, point.building_id):
                return row
    return None


def _by_issue_no(session: Session, workspace: Workspace, issue_no: str) -> Issue | None:
    rows = session.scalars(select(Issue).where(Issue.dataset_id == workspace.dataset_id))
    for row in rows:
        if row.issue_no.upper() == issue_no.upper() and _in_scope(workspace, row.building_id):
            return row
    return None


def _by_order_no(session: Session, workspace: Workspace, order_no: str) -> WorkOrder | None:
    rows = session.scalars(select(WorkOrder).where(WorkOrder.dataset_id == workspace.dataset_id))
    for row in rows:
        if row.order_no.upper() == order_no.upper():
            building_id = None
            if row.point_id:
                point = session.get(Point, (workspace.dataset_id, row.point_id))
                building_id = point.building_id if point else None
            if _in_scope(workspace, building_id):
                return row
    return None


def _fail(out: Resolved, conclusion: str, gap: str) -> None:
    out.status = "not_found"
    out.conclusion = conclusion
    out.gaps.append(gap)


def _explicit_numbers(
    session: Session, workspace: Workspace, entities: dict, out: Resolved
) -> None:
    """问句里写明的编号优先于任何旧上下文。"""
    if entities["eventNo"] is not None:
        row = _by_event_no(session, workspace, entities["eventNo"])
        if row is None:
            _fail(
                out, f"当前数据集里没有编号 {entities['eventNo']} 的预警事件。", "event_no_missing"
            )
            return
        out.event_id = row.id
        out.point_id = row.point_id
        out.explicit = True
    if entities["issueNo"] is not None:
        row = _by_issue_no(session, workspace, entities["issueNo"])
        if row is None:
            _fail(out, f"当前数据集里没有编号 {entities['issueNo']} 的问题。", "issue_no_missing")
            return
        out.issue_id = row.id
        out.explicit = True
        if out.point_id is None:
            out.point_id = row.point_id
    if entities["orderNo"] is not None:
        row = _by_order_no(session, workspace, entities["orderNo"])
        if row is None:
            _fail(out, f"当前数据集里没有编号 {entities['orderNo']} 的工单。", "order_no_missing")
            return
        out.work_order_id = row.id
        out.explicit = True
        issue = find_issue(session, workspace, row.issue_id)
        if out.issue_id is not None and out.issue_id != row.issue_id:
            _fail(
                out,
                f"问句同时指到工单 {row.order_no} 与另一个问题，二者关联不一致，请分开询问。",
                "conflicting_objects",
            )
            return
        if issue is not None:
            out.issue_id = issue.id
            if out.point_id is None:
                out.point_id = issue.point_id
            if out.building_id is None:
                out.building_id = issue.building_id
        if out.point_id is None:
            out.point_id = row.point_id


def _explicit_point(
    session: Session, workspace: Workspace, entities: dict, intent: str, out: Resolved
) -> None:
    """显式测点编号或楼栋/指标线索覆盖旧测点；同名多项先澄清。"""
    if out.status != "resolved":
        return
    if entities["pointCode"] is not None:
        matched = _by_code(session, workspace, entities["pointCode"])
    elif (
        out.point_id is None
        and intent in {"point_status", "point_trend", "reading_recovery", "media_compare"}
        and has_point_clue(entities)
    ):
        if entities["metric"] is not None:
            matched = _by_metric(session, workspace, entities["metric"])
        else:
            matched = []
            for ref in entities["buildingRefs"]:
                matched.extend(_by_building(session, workspace, ref))
    else:
        return
    matched = _filter_clues(session, workspace, matched, entities)
    unique = {row.id: row for row in matched}
    if len(unique) == 1:
        row = next(iter(unique.values()))
        if out.point_id is not None and out.point_id != row.id:
            out.status = "need_choice"
            out.conclusion = "问句里的对象编号指向不同测点，请确认要讨论哪一个。"
            out.candidates = [_point_out(row)]
            return
        out.point_id = row.id
        out.building_id = row.building_id
        out.explicit = True
        return
    if len(unique) > 1:
        out.status = "need_choice"
        out.conclusion = (
            f"编号 {entities['pointCode']} 命中多个测点，请选择其中一个。"
            if entities["pointCode"] is not None
            else f"问句线索命中 {len(unique)} 个测点，请选择其中一个。"
        )
        out.candidates = [_point_out(row) for row in list(unique.values())[:8]]
        return
    if entities["pointCode"] is not None:
        _fail(out, "当前数据集与授权范围内没有匹配这个编号的测点。", "point_not_found")
    else:
        _fail(out, "当前数据集与授权范围内没有匹配这个线索的测点。", "point_not_found")


def _apply_choice(session: Session, workspace: Workspace, context: dict, out: Resolved) -> None:
    """候选点击：只有用户明确点选（chosen）且 ID 属于本轮候选时才采用。"""
    if out.status != "need_choice" or context.get("chosen") is not True:
        return
    ids = {row["id"] for row in out.candidates}
    point_id = str(context.get("pointId") or "")
    event_id = str(context.get("eventId") or "")
    if point_id in ids:
        row = find_point(session, workspace, point_id)
        if row is None:
            return
        out.point_id, out.building_id = row.id, row.building_id
    elif event_id in ids:
        row = find_event(session, workspace, event_id)
        if row is None:
            return
        out.event_id, out.point_id = row.id, row.point_id
    else:
        return
    out.status = "resolved"
    out.conclusion = ""
    out.candidates = []
    out.explicit = True


def _apply_context(session: Session, workspace: Workspace, context: dict, out: Resolved) -> None:
    """只补尚未指定的对象；显式对象已确定（即使关联为空）时不再用旧上下文补空。"""
    if out.status != "resolved":
        return
    if out.point_id is None and not out.explicit and context.get("pointId") is not None:
        row = find_point(session, workspace, str(context["pointId"]))
        if row is None:
            _fail(
                out,
                "上下文里的测点已不在当前数据集或超出授权范围，请重新选择测点。",
                "context_point_missing",
            )
            return
        out.point_id = row.id
        out.building_id = row.building_id
    if not out.explicit and out.event_id is None and context.get("eventId") is not None:
        row = find_event(session, workspace, str(context["eventId"]))
        if row is None:
            _fail(
                out,
                "上下文里的预警事件已不在当前数据集或超出授权范围，请重新选择事件。",
                "context_event_missing",
            )
            return
        if out.point_id is None:
            out.event_id = row.id
            out.point_id = row.point_id
        elif row.point_id == out.point_id:
            out.event_id = row.id
    if out.explicit:
        return
    for key, finder, attr, label in (
        ("issueId", find_issue, "issue_id", "问题"),
        ("workOrderId", find_order, "work_order_id", "工单"),
    ):
        if out.__dict__[attr] is not None or context.get(key) is None:
            continue
        row = finder(session, workspace, str(context[key]))
        if row is None:
            _fail(
                out, f"上下文里的{label}已不在当前数据集或超出授权范围。", f"context_{key}_missing"
            )
            return
        if out.point_id is None or getattr(row, "point_id", None) in (None, out.point_id):
            setattr(out, attr, row.id)
            if out.point_id is None:
                out.point_id = getattr(row, "point_id", None)


def _bind_point_event(session: Session, workspace: Workspace, intent: str, out: Resolved) -> None:
    """唯一未关闭事件可确定关联；追问多条事件时先让人选择。"""
    if out.status != "resolved" or out.point_id is None or out.event_id is not None:
        return
    rows = session.scalars(
        select(AlarmEvent).where(
            AlarmEvent.dataset_id == workspace.dataset_id,
            AlarmEvent.point_id == out.point_id,
            AlarmEvent.status != "closed",
        )
    )
    events = sorted(rows, key=lambda row: row.last_trigger_at or "", reverse=True)
    if len(events) == 1:
        out.event_id = events[0].id
        return
    if len(events) > 1 and intent in {
        "event_reason",
        "reading_recovery",
        "event_replay",
        "demo_guide",
    }:
        out.status = "need_choice"
        out.conclusion = "该测点有多条未关闭事件，请先选择要讨论的事件。"
        out.candidates = [
            {"id": row.id, "label": row.event_no, "detail": f"{row.level} / {row.status}"}
            for row in events[:8]
        ]


@dataclass(frozen=True)
class ResolveInput:
    """一次对象解析的全部输入；字段只增不改，避免继续增长参数列表。"""

    session: Session
    workspace: Workspace
    question: str
    context: dict
    entities: dict
    intent: str


def resolve_objects(data: ResolveInput) -> Resolved:
    """优先级（S7-04）：本轮显式编号 > 显式测点线索 > 页面/上一轮上下文。"""
    out = Resolved()
    _explicit_numbers(data.session, data.workspace, data.entities, out)
    _explicit_point(data.session, data.workspace, data.entities, data.intent, out)
    _apply_choice(data.session, data.workspace, data.context, out)
    _apply_context(data.session, data.workspace, data.context, out)
    _bind_point_event(data.session, data.workspace, data.intent, out)
    _apply_choice(data.session, data.workspace, data.context, out)
    if out.status != "resolved":
        return out
    if out.point_id is not None and out.building_id is None:
        point = data.session.get(Point, (data.workspace.dataset_id, out.point_id))
        out.building_id = point.building_id if point else None
    if out.issue_id is not None and out.point_id is None:
        issue = data.session.get(Issue, (data.workspace.dataset_id, out.issue_id))
        if issue is not None:
            out.point_id = issue.point_id
    if out.work_order_id is not None and out.issue_id is None:
        order = data.session.get(WorkOrder, (data.workspace.dataset_id, out.work_order_id))
        if order is not None:
            out.issue_id = order.issue_id
    return out
