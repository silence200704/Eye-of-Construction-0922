"""阶段 7：小瞳问答、会话与影像会话路由；写入统一走命令执行器。"""

from fastapi import APIRouter, Request

from ....operations.assistant import sessions as session_ops
from ....operations.assistant.answer import compose
from ....operations.datasets.core.workspace import (
    AuditEntry,
    Command,
    execute_command,
    write_audit,
)
from ....operations.media import session as media_session
from ..common import Current, Read, Write, reply
from .schemas import (
    AssistantQueryInput,
    MediaCompareInput,
    MediaFrameInput,
    MediaVideoInput,
    VideoAnalysisInput,
)

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}/assistant", tags=["小瞳问答"])


def _audit(session: Write, current: Current, action: str, object_id: str, summary: str) -> None:
    write_audit(
        session,
        current,
        AuditEntry(
            action=action,
            object_type="assistant",
            object_id=object_id,
            object_label="小瞳会话与影像",
            summary=summary[:180],
        ),
    )


@router.post("/query")
def query(request: Request, session: Write, current: Current, body: AssistantQueryInput) -> dict:
    payload = body.model_dump()

    def save() -> dict:
        answer = compose.query(session, current, request.app.state.settings.runtime_dir, payload)
        at = answer["sources"]["queriedAt"]
        row = session_ops.ensure_session(
            session, current, payload.get("sessionId"), at, payload["question"]
        )
        turn = session_ops.append_turn(
            session,
            current,
            row,
            session_ops.TurnInput(question=payload["question"], answer=answer, at=at),
        )
        _audit(session, current, "assistant_query", row.id, f"保存小瞳问答：{payload['question']}")
        return {"sessionId": row.id, "turnId": turn.id, "answer": answer}

    data, replayed = execute_command(
        session, current, Command(request, "assistant_query", payload), save
    )
    if replayed:
        data = {**data, "answer": session_ops.visible_answer(session, current, data["answer"])}
    return reply(request, current, data, replayed=replayed)


@router.get("/sessions")
def listing(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, session_ops.list_sessions(session, current))


@router.get("/sessions/{session_id}")
def detail(request: Request, session: Read, current: Current, session_id: str) -> dict:
    return reply(request, current, session_ops.read_session(session, current, session_id))


media_router = APIRouter(prefix="/api/v1/datasets/{dataset_id}/media-sessions", tags=["影像会话"])


def _replay_guard(session, current, data: dict, replayed: bool) -> dict:
    if replayed:
        media_session.replay_visible(session, current, data)
    return data


@media_router.get("/frames")
def frames(request: Request, session: Read, current: Current, pointId: str | None = None) -> dict:
    return reply(request, current, media_session.list_frames(session, current, pointId))


@media_router.post("/frames")
def register_frame(
    request: Request, session: Write, current: Current, body: MediaFrameInput
) -> dict:
    payload = body.model_dump()

    def save() -> dict:
        result = media_session.register_frame(session, current, payload)
        _audit(session, current, "assistant_frame_register", result["id"], "登记影像会话关键帧")
        return result

    data, replayed = execute_command(
        session, current, Command(request, "assistant_frame_register", payload), save
    )
    return reply(
        request, current, _replay_guard(session, current, data, replayed), replayed=replayed
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
    payload = body.model_dump()

    def save() -> dict:
        result = media_session.save_comparison(session, current, payload)
        _audit(session, current, "assistant_comparison_save", result["id"], "保存影像会话比对结果")
        return result

    data, replayed = execute_command(
        session, current, Command(request, "assistant_comparison_save", payload), save
    )
    return reply(
        request, current, _replay_guard(session, current, data, replayed), replayed=replayed
    )


@media_router.get("/videos")
def videos(request: Request, session: Read, current: Current, pointId: str | None = None) -> dict:
    return reply(request, current, media_session.list_videos(session, current, pointId))


@media_router.post("/videos")
def register_video(
    request: Request, session: Write, current: Current, body: MediaVideoInput
) -> dict:
    payload = body.model_dump()

    def save() -> dict:
        result = media_session.register_video(session, current, payload)
        _audit(session, current, "assistant_video_register", result["id"], "登记会话视频元数据")
        return result

    data, replayed = execute_command(
        session, current, Command(request, "assistant_video_register", payload), save
    )
    return reply(
        request, current, _replay_guard(session, current, data, replayed), replayed=replayed
    )


@media_router.post("/videos/{video_id}/analysis")
def save_video_analysis(
    request: Request, session: Write, current: Current, video_id: str, body: VideoAnalysisInput
) -> dict:
    payload = {"videoId": video_id, **body.model_dump()}

    def save() -> dict:
        result = media_session.save_video_analysis(session, current, payload)
        _audit(session, current, "assistant_video_analysis", result["id"], "保存视频分析结果")
        return result

    data, replayed = execute_command(
        session, current, Command(request, "assistant_video_analysis", payload), save
    )
    return reply(
        request, current, _replay_guard(session, current, data, replayed), replayed=replayed
    )


@media_router.get("/summary")
def summary(request: Request, session: Read, current: Current, pointId: str | None = None) -> dict:
    return reply(request, current, media_session.session_summary(session, current, pointId))
