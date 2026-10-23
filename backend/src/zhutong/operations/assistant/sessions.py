"""会话持久化：按身份与数据集隔离，轮次随查询命令写入同一事务。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.models.assistant import AssistantSession, AssistantTurn
from ..datasets.core.workspace import Workspace, uid


def active_session(
    session: Session, workspace: Workspace, session_id: str | None
) -> AssistantSession | None:
    if session_id:
        row = session.get(
            AssistantSession,
            (workspace.dataset_id, session_id),
        )
        if row is not None and row.actor_id == workspace.actor.id:
            return row
    rows = session.scalars(
        select(AssistantSession)
        .where(
            AssistantSession.dataset_id == workspace.dataset_id,
            AssistantSession.actor_id == workspace.actor.id,
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
    question: str,
    answer: dict,
    now: str,
) -> AssistantTurn:
    turn = AssistantTurn(
        dataset_id=workspace.dataset_id,
        id=uid("at"),
        session_id=assistant_session.id,
        seq=assistant_session.turn_count + 1,
        actor_id=workspace.actor.id,
        question=question,
        answer=answer,
        created_at=now,
    )
    session.add(turn)
    assistant_session.turn_count += 1
    assistant_session.updated_at = now
    if assistant_session.title == "":
        assistant_session.title = question[:40]
    session.flush()
    return turn


def session_out(
    session: Session,
    workspace: Workspace,
    row: AssistantSession,
    turns: list[AssistantTurn] | None = None,
) -> dict:
    data = {
        "id": row.id,
        "title": row.title,
        "turnCount": row.turn_count,
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
        "actorId": row.actor_id,
    }
    if turns is not None:
        data["turns"] = [turn_out(turn) for turn in turns]
    return data


def turn_out(turn: AssistantTurn) -> dict:
    return {
        "id": turn.id,
        "seq": turn.seq,
        "question": turn.question,
        "answer": turn.answer,
        "createdAt": turn.created_at,
    }


def list_sessions(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(AssistantSession)
        .where(
            AssistantSession.dataset_id == workspace.dataset_id,
            AssistantSession.actor_id == workspace.actor.id,
        )
        .order_by(AssistantSession.updated_at.desc())
    )
    return [session_out(session, workspace, row) for row in rows]


def read_session(session: Session, workspace: Workspace, session_id: str) -> dict | None:
    row = session.get(AssistantSession, (workspace.dataset_id, session_id))
    if row is None or row.actor_id != workspace.actor.id:
        return None
    turns = session.scalars(
        select(AssistantTurn)
        .where(
            AssistantTurn.dataset_id == workspace.dataset_id,
            AssistantTurn.session_id == row.id,
        )
        .order_by(AssistantTurn.seq)
    )
    return session_out(session, workspace, row, list(turns))
