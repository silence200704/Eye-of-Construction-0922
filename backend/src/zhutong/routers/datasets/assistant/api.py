"""阶段 7：小瞳问答、会话与影像会话路由。"""

from fastapi import APIRouter, Request

from ....operations.assistant import compose
from ....operations.assistant import sessions as session_ops
from ....operations.media import session as media_session
from ..common import Current, Read, Write, reply
from .schemas import AssistantQueryInput, MediaCompareInput, MediaFrameInput

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}/assistant", tags=["小瞳问答"])


@router.post("/query")
def query(request: Request, session: Write, current: Current, body: AssistantQueryInput) -> dict:
    payload = body.model_dump()
    answer = compose.query(session, current, request.app.state.settings.runtime_dir, payload)
    row = session_ops.ensure_session(
        session,
        current,
        payload.get("sessionId"),
        answer["sources"]["queriedAt"],
        payload["question"],
    )
    turn = session_ops.append_turn(
        session,
        current,
        row,
        payload["question"],
        answer,
        answer["sources"]["queriedAt"],
    )
    return reply(
        request,
        current,
        {"sessionId": row.id, "turnId": turn.id, "answer": answer},
    )


@router.get("/sessions")
def listing(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, session_ops.list_sessions(session, current))


@router.get("/sessions/{session_id}")
def detail(request: Request, session: Read, current: Current, session_id: str) -> dict:
    data = session_ops.read_session(session, current, session_id)
    if data is None:
        from ....core.errors import AppError

        raise AppError("NOT_FOUND", "会话不存在或不属于当前身份", 404, {"sessionId": session_id})
    return reply(request, current, data)


media_router = APIRouter(prefix="/api/v1/datasets/{dataset_id}/media-sessions", tags=["影像会话"])


@media_router.get("/frames")
def frames(request: Request, session: Read, current: Current, pointId: str | None = None) -> dict:
    return reply(request, current, media_session.list_frames(session, current, pointId))


@media_router.post("/frames")
def register_frame(
    request: Request, session: Write, current: Current, body: MediaFrameInput
) -> dict:
    return reply(
        request, current, media_session.register_frame(session, current, body.model_dump())
    )


@media_router.get("/comparisons")
def comparisons(
    request: Request, session: Read, current: Current, pointId: str | None = None
) -> dict:
    return reply(request, current, media_session.list_comparisons(session, current, pointId))


@media_router.post("/comparisons")
def save_comparison(
    request: Request, session: Write, current: Current, body: MediaCompareInput
) -> dict:
    return reply(
        request, current, media_session.save_comparison(session, current, body.model_dump())
    )


@media_router.get("/summary")
def summary(request: Request, session: Read, current: Current, pointId: str | None = None) -> dict:
    return reply(request, current, media_session.session_summary(session, current, pointId))
