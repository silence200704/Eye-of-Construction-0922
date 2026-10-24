"""事件回放、相似案例与候选阈值试算：只读，不写库、不触发事件。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.models.field import Issue, WorkOrder
from ...db.models.monitoring import AlarmEvent
from ..datasets.core.record_queries import records_of_point
from ..datasets.core.workspace import Workspace, can_access_building
from .facts import LEVEL_TEXT, queried_at


def event_replay(session: Session, workspace: Workspace, event: AlarmEvent) -> dict:
    nodes = [
        {
            "id": f"evt_{index}",
            "at": row.get("at"),
            "title": row.get("action"),
            "detail": row.get("detail", ""),
            "by": row.get("by"),
        }
        for index, row in enumerate(event.timeline or [])
    ]
    issues = session.scalars(
        select(Issue).where(Issue.dataset_id == workspace.dataset_id, Issue.event_id == event.id)
    )
    for issue in issues:
        for index, row in enumerate(issue.timeline or []):
            nodes.append(
                {
                    "id": f"iss_{issue.id}_{index}",
                    "at": row.get("at"),
                    "title": f"问题 {issue.issue_no}：{row.get('action')}",
                    "detail": row.get("detail", ""),
                    "by": row.get("by"),
                }
            )
    orders = session.scalars(
        select(WorkOrder).where(
            WorkOrder.dataset_id == workspace.dataset_id, WorkOrder.event_id == event.id
        )
    )
    for order in orders:
        for index, row in enumerate(order.timeline or []):
            nodes.append(
                {
                    "id": f"wo_{order.id}_{index}",
                    "at": row.get("at"),
                    "title": f"工单 {order.order_no}：{row.get('action')}",
                    "detail": row.get("detail", ""),
                    "by": row.get("by"),
                }
            )
    nodes.sort(key=lambda row: str(row.get("at") or ""))
    conclusion = f"{event.event_no} 处置回放共 {len(nodes)} 个节点（事件、问题、工单按时间合并）。"
    return {
        "conclusion": conclusion,
        "facts": [],
        "evidence": [],
        "extras": {"replay": nodes, "queriedAt": queried_at()},
    }


def case_search(session: Session, workspace: Workspace, point_id: str | None, keyword: str) -> dict:
    rows = session.scalars(select(Issue).where(Issue.dataset_id == workspace.dataset_id))
    matched = []
    for row in rows:
        if not can_access_building(workspace, row.building_id):
            continue
        if row.building_id is None and workspace.actor.building_ids is not None:
            continue
        if point_id is not None and row.point_id != point_id:
            continue
        if keyword and keyword not in row.anomaly_type and keyword not in row.description:
            continue
        orders = session.scalars(
            select(WorkOrder).where(
                WorkOrder.dataset_id == workspace.dataset_id, WorkOrder.issue_id == row.id
            )
        )
        order_rows = list(orders)
        complete = (
            row.status == "closed"
            and bool(row.rechecks)
            and any(o.status == "verified" for o in order_rows)
        )
        gaps = []
        if row.status != "closed":
            gaps.append("问题未关闭")
        if not row.rechecks:
            gaps.append("未登记复查")
        if not any(o.status == "verified" for o in order_rows):
            gaps.append("工单未验收")
        matched.append(
            {
                "issueId": row.id,
                "issueNo": row.issue_no,
                "anomalyType": row.anomaly_type,
                "status": row.status,
                "complete": complete,
                "gaps": gaps,
                "measures": "；".join(o.measures for o in order_rows if o.measures),
                "at": row.created_at,
            }
        )
    matched.sort(key=lambda item: item["at"], reverse=True)
    matched = matched[:8]
    conclusion = (
        f"找到 {len(matched)} 条{'相关' if keyword or point_id else ''}问题记录。"
        if matched
        else "没有匹配的历史问题记录。"
    )
    return {
        "conclusion": conclusion,
        "facts": [],
        "evidence": [],
        "extras": {"cases": matched, "queriedAt": queried_at()},
    }


def rule_simulate(session: Session, workspace: Workspace, point, candidate: dict) -> dict:
    rows = [row for row in records_of_point(session, workspace, point.id) if row.quality == "valid"]
    rows.sort(key=lambda row: row.sample_time)
    yellow = float(candidate.get("yellow", 0))
    orange = float(candidate.get("orange", 0))
    red = float(candidate.get("red", 0))
    out = []
    for row in rows[-20:]:
        value = next(iter(row.values.values()), None)
        if not isinstance(value, (int, float)):
            continue
        original = row.assessment.get("level") if row.assessment else None
        candidate_level = (
            "red"
            if value >= red
            else "orange"
            if value >= orange
            else "yellow"
            if value >= yellow
            else "normal"
        )
        out.append(
            {
                "recordNo": row.record_no,
                "original": LEVEL_TEXT.get(original or "normal", original or "normal"),
                "candidate": LEVEL_TEXT.get(candidate_level, candidate_level),
                "changed": candidate_level != (original or "normal"),
            }
        )
    changed = sum(1 for row in out if row["changed"])
    conclusion = (
        f"按候选阈值（黄 {yellow:g}／橙 {orange:g}／红 {red:g}）对最近 {len(out)} 条有效记录试算，"
        f"{changed} 条等级会变化；试算不写库、不触发事件。"
    )
    return {
        "conclusion": conclusion,
        "facts": [],
        "evidence": [],
        "extras": {"simulation": out, "queriedAt": queried_at()},
    }
