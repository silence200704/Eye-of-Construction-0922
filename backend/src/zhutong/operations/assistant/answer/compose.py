"""回答组装：解析 → 对象解析 → 业务事实 → 知识引用 → 结构化答案。

事实与知识分别标注来源：facts 来自数据库（含查询时刻与对象行版本），
knowledge 来自阶段 6 检索（含 chunkId/版本/哈希）。建议不是已执行的动作。
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.orm import Session

from ....db.models.archive import Point
from ....db.models.field import Issue
from ....db.models.monitoring import AlarmEvent, MonitorRecord
from ...datasets.core.workspace import Workspace
from ..parse import extract_entities, normalize, parse_intent
from ..resolve import (
    Resolved,
    ResolveInput,
    find_event,
    find_issue,
    find_order,
    find_point,
    resolve_objects,
)
from . import facts, facts_extras, facts_more
from .flows import _candidate_thresholds, _demo_command_answer, _frontend_flow_answer
from .knowledge_answers import _attach_knowledge, _knowledge, _knowledge_answer

NAV_KINDS = {
    "point_status": [
        ("point_trend", "pointId"),
        ("spatial_3d", "pointId"),
        ("media_page", "pointId"),
    ],
    "point_trend": [("point_trend", "pointId")],
    "event_reason": [("event_detail", "eventId"), ("event_report", "eventId")],
    "open_events": [("alarm_queue", None)],
    "issue_status": [("issue_detail", "issueId"), ("workorder_detail", "workOrderId")],
    "reading_recovery": [("event_detail", "eventId"), ("point_trend", "pointId")],
    "event_replay": [("event_detail", "eventId")],
    "case_search": [],
    "campus_overview": [("overview", None)],
    "media_compare": [("media_page", "pointId")],
    "rule_simulate": [("monitor", None)],
    "demo_command": [("settings", None)],
}
ROLE_NEXT_STEP = {
    "pending": "待学校安全管理人员确认",
    "handling": "处理中，可转问题或继续处置",
    "recovering": "恢复待确认，需满足恢复条件后由人关闭",
    "closed": "已关闭",
}


def _now() -> datetime:
    return datetime.now(UTC)


def _links(intent: str, resolved: Resolved) -> list[dict]:
    links = []
    for kind, key in NAV_KINDS.get(intent, []):
        object_id = ""
        if key == "pointId":
            object_id = resolved.point_id or ""
        elif key == "eventId":
            object_id = resolved.event_id or ""
        elif key == "issueId":
            object_id = resolved.issue_id or ""
        elif key == "workOrderId":
            object_id = resolved.work_order_id or ""
        if key is not None and object_id == "":
            continue
        links.append({"kind": kind, "objectId": object_id})
    if intent == "spatial_go" and resolved.point_id:
        links.insert(0, {"kind": "spatial_3d", "objectId": resolved.point_id})
    return links


def _objects(resolved: Resolved) -> dict:
    return {
        "pointId": resolved.point_id,
        "eventId": resolved.event_id,
        "issueId": resolved.issue_id,
        "workOrderId": resolved.work_order_id,
        "buildingId": resolved.building_id,
    }


def _followups(intent: str, resolved: Resolved) -> list[str]:
    if intent == "point_status" and resolved.point_id:
        return ["它最近的变化趋势怎么样", "这条预警为什么被触发", "带我到 3D 看位置"]
    if intent == "event_reason" and resolved.event_id:
        return ["这个问题处理到哪了", "读数恢复了吗", "回放这次处置"]
    if intent == "issue_status" and resolved.issue_id:
        return ["这张工单验收了吗", "复查安排是什么", "打开完整处置报告"]
    return ["全校现在概况如何", "现在有哪些未关闭预警"]


def query(session: Session, workspace: Workspace, runtime: Path, payload: dict) -> dict:
    question = str(payload.get("question", "")).strip()
    context = payload.get("context") or {}
    now = _now()
    q = normalize(question)
    entities = extract_entities(q)
    intent = parse_intent(q, entities)
    resolved = resolve_objects(
        ResolveInput(
            session=session,
            workspace=workspace,
            question=question,
            context=context,
            entities=entities,
            intent=intent,
        )
    )
    knowledge = _knowledge(session, workspace, runtime, question)
    if intent == "knowledge":
        answer = _knowledge_answer(knowledge)
    elif resolved.status in {"need_choice", "not_found"}:
        answer = _attach_knowledge(_context_answer(resolved, intent, question), knowledge, intent)
    else:
        answer = _business_answer(
            AnswerInput(
                session=session,
                workspace=workspace,
                intent=intent,
                resolved=resolved,
                entities=entities,
                now=now,
                payload=payload,
            )
        )
        if answer is None or answer.get("intent") == "unknown":
            answer = _knowledge_answer(knowledge)
        else:
            answer = _attach_knowledge(answer, knowledge, intent)
            if (
                answer.get("status") == "answered"
                and answer.get("sources", {}).get("facts") == "server_db"
            ):
                answer["snapshot"] = _fact_snapshot(session, workspace, resolved, answer)
    if answer is not None:
        answer.setdefault("intent", intent)
        answer["question"] = question
        answer["objects"] = _objects(resolved)
        answer["links"] = _links(answer.get("intent", intent), resolved)
        answer["followups"] = _followups(answer.get("intent", intent), resolved)
        facts_source = answer.get("sources", {}).get("facts")
        note = (
            "业务事实来自服务端数据库本次查询；知识解释来自本地知识库引用；建议不等于已执行。"
            if facts_source == "server_db"
            else "知识回答来自本地知识库引用，不是现场实时数据；建议不等于已执行。"
        )
        answer["dataNotes"] = answer.get("dataNotes", []) + [note]
    return answer


def _fact_snapshot(
    session: Session, workspace: Workspace, resolved: Resolved, answer: dict
) -> dict:
    objects: dict[str, dict] = {}
    for key, attr, finder in (
        ("pointId", "point_id", find_point),
        ("eventId", "event_id", find_event),
        ("issueId", "issue_id", find_issue),
        ("workOrderId", "work_order_id", find_order),
    ):
        row = finder(session, workspace, getattr(resolved, attr))
        if row is not None:
            objects[key] = {"id": row.id, "rev": row.revision}
    records = []
    for row in answer.get("evidence") or []:
        if row.get("kind") != "record":
            continue
        record = session.get(MonitorRecord, (workspace.dataset_id, row.get("id")))
        if record is not None:
            records.append(
                {"id": record.id, "rev": record.revision, "recordRevision": record.record_revision}
            )
    extras = answer.get("extras") or {}
    return {
        "queriedAt": answer.get("sources", {}).get("queriedAt", ""),
        "objects": objects,
        "records": records,
        "rules": [extras["rule"]] if isinstance(extras.get("rule"), dict) else [],
        "baselines": [extras["baseline"]] if isinstance(extras.get("baseline"), dict) else [],
    }


def _context_answer(resolved: Resolved, intent: str, question: str) -> dict:
    return {
        "intent": intent,
        "status": resolved.status,
        "conclusion": resolved.conclusion,
        "facts": [],
        "evidence": [],
        "candidates": resolved.candidates,
        "gaps": resolved.gaps,
        "sources": {"facts": "none", "queriedAt": facts.queried_at()},
    }


@dataclass(frozen=True)
class AnswerInput:
    """业务回答输入：只读依赖与问句载荷一起传递，避免超参数。"""

    session: Session
    workspace: Workspace
    intent: str
    resolved: Resolved
    entities: dict
    now: datetime
    payload: dict


def _business_answer(data: AnswerInput) -> dict | None:
    session, workspace = data.session, data.workspace
    intent, resolved, entities = data.intent, data.resolved, data.entities
    now, payload = data.now, data.payload
    if intent == "campus_overview":
        return _wrap(facts_more.campus_overview(session, workspace), resolved)
    if intent == "open_events":
        return _wrap(facts_more.open_events(session, workspace), resolved)
    if intent in {"point_status", "media_compare"}:
        point = _need_point(session, workspace, resolved)
        if point is None:
            return _missing_point(intent, entities)
        return _wrap(
            facts.point_status(
                facts.PointStatusInput(
                    session=session, workspace=workspace, resolved=resolved, point=point, now=now
                )
            ),
            resolved,
        )
    if intent == "point_trend":
        point = _need_point(session, workspace, resolved)
        if point is None:
            return _missing_point(intent, entities)
        return _wrap(facts_more.point_trend(session, workspace, point, now), resolved)
    if intent == "event_reason":
        event = _need_event(session, workspace, resolved)
        if event is None:
            return _missing_event(intent, entities)
        return _wrap(facts_more.event_reason(session, workspace, event), resolved)
    if intent == "reading_recovery":
        event = _need_event(session, workspace, resolved)
        if event is None:
            return _missing_event(intent, entities)
        return _wrap(
            facts_more.reading_recovery(session, workspace, resolved, event, now), resolved
        )
    if intent == "event_replay":
        event = _need_event(session, workspace, resolved)
        if event is None:
            return _missing_event(intent, entities)
        return _wrap(facts_extras.event_replay(session, workspace, event), resolved)
    if intent == "issue_status":
        return _issue_answer(session, workspace, resolved, entities)
    if intent == "case_search":
        keyword = ""
        for word in ("裂缝", "倾斜", "锈蚀", "渗水"):
            if word in payload.get("question", ""):
                keyword = word
                break
        return _wrap(
            facts_extras.case_search(session, workspace, resolved.point_id, keyword), resolved
        )
    if intent == "rule_simulate":
        point = _need_point(session, workspace, resolved)
        if point is None:
            return _missing_point(intent, entities)
        candidate = _candidate_thresholds(payload.get("question", ""), payload.get("context") or {})
        return _wrap(facts_extras.rule_simulate(session, workspace, point, candidate), resolved)
    if intent in {"spatial_go", "video_compare", "visual_evidence", "visual_region"}:
        point = _need_point(session, workspace, resolved)
        if point is None:
            return _missing_point(intent, entities)
        return _frontend_flow_answer(intent, point)
    if intent == "demo_guide":
        return _guide_answer(session, workspace, resolved)
    if intent == "demo_command":
        return _demo_command_answer()
    return None


def _wrap(result: dict, resolved: Resolved) -> dict:
    result.setdefault("status", "answered")
    result["candidates"] = resolved.candidates
    result["sources"] = {
        "facts": "server_db",
        "queriedAt": result.get("extras", {}).get("queriedAt", facts.queried_at()),
    }
    return result


def _need_point(session: Session, workspace: Workspace, resolved: Resolved) -> Point | None:
    return find_point(session, workspace, resolved.point_id)


def _need_event(session: Session, workspace: Workspace, resolved: Resolved) -> AlarmEvent | None:
    return find_event(session, workspace, resolved.event_id)


def _missing_point(intent: str, entities: dict) -> dict:
    return {
        "intent": intent,
        "status": "not_found",
        "conclusion": "请先指明或选择一个测点：当前问句没有可绑定的测点，本回答不使用默认对象。",
        "facts": [],
        "evidence": [],
        "gaps": ["point_required"],
        "sources": {"facts": "none", "queriedAt": facts.queried_at()},
    }


def _missing_event(intent: str, entities: dict) -> dict:
    return {
        "intent": intent,
        "status": "not_found",
        "conclusion": "请先指明或选择一条预警事件：当前问句没有可绑定的事件。",
        "facts": [],
        "evidence": [],
        "gaps": ["event_required"],
        "sources": {"facts": "none", "queriedAt": facts.queried_at()},
    }


def _issue_answer(
    session: Session, workspace: Workspace, resolved: Resolved, entities: dict
) -> dict:
    issue = find_issue(session, workspace, resolved.issue_id)
    if issue is None:
        issue = _latest_issue_of_point(session, workspace, resolved.point_id)
    if issue is None:
        return {
            "intent": "issue_status",
            "status": "not_found",
            "conclusion": "请指明问题编号或先选择相关测点：当前没有可绑定的问题。",
            "facts": [],
            "evidence": [],
            "gaps": ["issue_required"],
            "sources": {"facts": "none", "queriedAt": facts.queried_at()},
        }
    order = None
    if resolved.work_order_id:
        order = find_order(session, workspace, resolved.work_order_id)
    if order is None and issue.work_order_ids:
        order = find_order(session, workspace, issue.work_order_ids[-1])
    resolved.issue_id = issue.id
    resolved.point_id = resolved.point_id or issue.point_id
    return _wrap(facts_more.issue_status(session, workspace, issue, order), resolved)


def _latest_issue_of_point(
    session: Session, workspace: Workspace, point_id: str | None
) -> Issue | None:
    if point_id is None:
        return None
    from sqlalchemy import select

    rows = session.scalars(
        select(Issue).where(Issue.dataset_id == workspace.dataset_id, Issue.point_id == point_id)
    )
    ordered = sorted(rows, key=lambda row: row.created_at, reverse=True)
    return ordered[0] if ordered else None


def _guide_answer(session: Session, workspace: Workspace, resolved: Resolved) -> dict:
    event = find_event(session, workspace, resolved.event_id)
    if event is None:
        if resolved.issue_id is not None:
            answer = _issue_answer(session, workspace, resolved, {})
            answer["intent"] = "issue_status"
            return answer
        return {
            "intent": "demo_guide",
            "status": "not_found",
            "conclusion": (
                "演示导览需要先绑定一条预警事件：请先在预警中心选择事件，再问「处理到哪了」。"
            ),
            "facts": [],
            "evidence": [],
            "gaps": ["event_required"],
            "sources": {"facts": "none", "queriedAt": facts.queried_at()},
        }
    status = ROLE_NEXT_STEP.get(event.status, event.status)
    return {
        "intent": "demo_guide",
        "status": "answered",
        "conclusion": (
            f"事件 {event.event_no} 当前：{status}。"
            "下一步动作在对应工作台由对应身份执行；小瞳只导航与说明，不代为办理。"
        ),
        "facts": [
            {
                "label": "事件状态",
                "value": ROLE_NEXT_STEP.get(event.status, event.status),
                "unit": "",
            }
        ],
        "evidence": [
            {"kind": "event", "ref": event.event_no, "id": event.id, "detail": "导览对象"}
        ],
        "gaps": [],
        "sources": {"facts": "server_db", "queriedAt": facts.queried_at()},
    }
