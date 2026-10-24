"""会话持久化：按身份、数据集与 epoch 隔离；恢复时按当前权限逐轮脱敏。"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.assistant import AssistantSession, AssistantTurn
from ...db.models.knowledge import KnowledgeChunk, KnowledgeDocument
from ...db.models.monitoring import MonitorRecord
from ..datasets.core.workspace import Workspace, can_access_building, uid
from .resolve import find_event, find_issue, find_order, find_point


@dataclass(frozen=True)
class TurnInput:
    question: str
    answer: dict
    at: str


def _owned_session(session: Session, workspace: Workspace, session_id: str) -> AssistantSession:
    row = session.get(AssistantSession, (workspace.dataset_id, session_id))
    if row is None or row.actor_id != workspace.actor.id:
        raise AppError("NOT_FOUND", "会话不存在或不属于当前身份", 404, {"sessionId": session_id})
    if row.epoch != workspace.epoch:
        raise AppError(
            "STALE_SESSION",
            "会话属于数据集复位前的 epoch，不能恢复或继续追加，请重新提问",
            410,
            {"sessionId": session_id, "sessionEpoch": row.epoch, "currentEpoch": workspace.epoch},
        )
    return row


def active_session(
    session: Session, workspace: Workspace, session_id: str | None
) -> AssistantSession | None:
    if session_id:
        return _owned_session(session, workspace, session_id)
    rows = session.scalars(
        select(AssistantSession)
        .where(
            AssistantSession.dataset_id == workspace.dataset_id,
            AssistantSession.actor_id == workspace.actor.id,
            AssistantSession.epoch == workspace.epoch,
        )
        .order_by(AssistantSession.updated_at.desc())
    )
    return next(iter(rows), None)


def ensure_session(
    session: Session, workspace: Workspace, session_id: str | None, now: str, question: str
) -> AssistantSession:
    row = active_session(session, workspace, session_id)
    if row is not None:
        return row
    row = AssistantSession(
        dataset_id=workspace.dataset_id,
        id=uid("as"),
        actor_id=workspace.actor.id,
        epoch=workspace.epoch,
        title=question[:40],
        turn_count=0,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    session.flush()
    return row


def append_turn(
    session: Session,
    workspace: Workspace,
    assistant_session: AssistantSession,
    data: TurnInput,
) -> AssistantTurn:
    turn = AssistantTurn(
        dataset_id=workspace.dataset_id,
        id=uid("at"),
        session_id=assistant_session.id,
        seq=assistant_session.turn_count + 1,
        actor_id=workspace.actor.id,
        question=data.question,
        answer=data.answer,
        created_at=data.at,
    )
    session.add(turn)
    assistant_session.turn_count += 1
    assistant_session.updated_at = data.at
    if assistant_session.title == "":
        assistant_session.title = data.question[:40]
    session.flush()
    return turn


def _objects_visible(session: Session, workspace: Workspace, answer: dict) -> bool:
    objects = answer.get("objects") or {}
    for key, finder in (
        ("pointId", find_point),
        ("eventId", find_event),
        ("issueId", find_issue),
        ("workOrderId", find_order),
    ):
        if objects.get(key) and finder(session, workspace, objects[key]) is None:
            return False
    building_id = objects.get("buildingId")
    if building_id and not can_access_building(workspace, building_id):
        return False
    if answer.get("sources", {}).get("facts") == "server_db":
        if not any(objects.get(key) for key in ("pointId", "eventId", "issueId", "workOrderId")):
            # 没有对象证据的聚合快照无法在历史回答里重新证明范围，受限身份只给脱敏状态。
            if workspace.actor.building_ids is not None:
                return False
    return True


def _evidence_visible(session: Session, workspace: Workspace, answer: dict) -> bool:
    for row in answer.get("evidence") or []:
        if row.get("kind") == "event" and find_event(session, workspace, row.get("id")) is None:
            return False
        if row.get("kind") == "issue" and find_issue(session, workspace, row.get("id")) is None:
            return False
        if row.get("kind") == "record":
            record = session.get(MonitorRecord, (workspace.dataset_id, row.get("id")))
            if record is None or find_point(session, workspace, record.point_id) is None:
                return False
    for row in (answer.get("extras") or {}).get("cases") or []:
        if find_issue(session, workspace, row.get("issueId")) is None:
            return False
    return True


def _citations_visible(session: Session, workspace: Workspace, answer: dict) -> bool:
    for row in answer.get("citations") or []:
        doc = session.get(KnowledgeDocument, row.get("documentId"))
        if doc is None or not doc.enabled:
            return False
        if workspace.actor.role != "safety" and workspace.actor.role not in (doc.roles or []):
            return False
        chunk = session.get(KnowledgeChunk, row.get("chunkId"))
        if chunk is None or chunk.document_id != doc.id or chunk.sha256 != row.get("sha256"):
            return False
    return True


def _turn_visible(session: Session, workspace: Workspace, answer: dict) -> bool:
    return (
        _objects_visible(session, workspace, answer)
        and _evidence_visible(session, workspace, answer)
        and _citations_visible(session, workspace, answer)
    )


def _redacted(answer: dict) -> dict:
    return {
        "intent": answer.get("intent", "unknown"),
        "status": "not_found",
        "conclusion": (
            "该轮引用的对象或知识已失效、归档或超出当前授权；原回答内容不再展示，请重新提问。"
        ),
        "facts": [],
        "evidence": [],
        "candidates": [],
        "citations": [],
        "gaps": ["history_unavailable"],
        "links": [],
        "followups": [],
        "dataNotes": ["历史回答已按当前身份、范围与对象状态脱敏；未重新执行任何写入或媒体处理。"],
        "sources": {"facts": "none", "queriedAt": answer.get("sources", {}).get("queriedAt", "")},
        "objects": {
            "pointId": None,
            "eventId": None,
            "issueId": None,
            "workOrderId": None,
            "buildingId": None,
        },
        "historical": True,
    }


def turn_out(session: Session, workspace: Workspace, turn: AssistantTurn) -> dict:
    visible = _turn_visible(session, workspace, turn.answer or {})
    return {
        "id": turn.id,
        "seq": turn.seq,
        "question": turn.question if visible else "（该轮内容已按当前权限隐藏）",
        "answer": turn.answer if visible else _redacted(turn.answer or {}),
        "createdAt": turn.created_at,
        "currentVisible": visible,
    }


def session_out(row: AssistantSession, turns: list[dict] | None = None) -> dict:
    data = {
        "id": row.id,
        "title": row.title,
        "turnCount": row.turn_count,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
        "actorId": row.actor_id,
        "epoch": row.epoch,
    }
    if turns is not None:
        data["turns"] = turns
    return data


def list_sessions(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(AssistantSession)
        .where(
            AssistantSession.dataset_id == workspace.dataset_id,
            AssistantSession.actor_id == workspace.actor.id,
            AssistantSession.epoch == workspace.epoch,
        )
        .order_by(AssistantSession.updated_at.desc())
    )
    return [session_out(row) for row in rows]


def read_session(session: Session, workspace: Workspace, session_id: str) -> dict:
    row = _owned_session(session, workspace, session_id)
    turns = session.scalars(
        select(AssistantTurn)
        .where(
            AssistantTurn.dataset_id == workspace.dataset_id,
            AssistantTurn.session_id == row.id,
        )
        .order_by(AssistantTurn.seq)
    )
    return session_out(row, [turn_out(session, workspace, turn) for turn in turns])
