"""影像会话持久化：关键帧登记与比对结果，复用既有媒体表与授权。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Point
from ...db.models.media import MediaComparison, MediaFile, MediaFrame
from ...db.models.monitoring import MonitorRecord
from ..datasets.core.workspace import Workspace, can_access_building, require_building, uid


def _media_readable(workspace: Workspace, media: MediaFile, point: Point | None) -> bool:
    if media.point_id is not None and (
        point is None or not can_access_building(workspace, point.building_id)
    ):
        return False
    if (
        media.point_id is None
        and media.uploaded_by != workspace.actor.id
        and workspace.actor.role != "safety"
    ):
        return False
    return True


def _point(session: Session, workspace: Workspace, point_id: str) -> Point:
    point = session.get(Point, (workspace.dataset_id, point_id))
    if point is None or point.status != "active":
        raise AppError("NOT_FOUND", "测点不存在或已归档", 404, {"pointId": point_id})
    require_building(workspace, point.building_id)
    return point


def _media(session: Session, workspace: Workspace, media_id: str) -> MediaFile:
    row = session.get(MediaFile, (workspace.dataset_id, media_id))
    if row is None:
        raise AppError("NOT_FOUND", "媒体不存在", 404, {"mediaId": media_id})
    point = session.get(Point, (workspace.dataset_id, row.point_id)) if row.point_id else None
    if not _media_readable(workspace, row, point):
        raise AppError("ROLE_FORBIDDEN", "无权读取该媒体", 403)
    return row


def _frame_out(row: MediaFrame, dataset_id: str, media: MediaFile | None = None) -> dict:
    return {
        "id": row.id,
        "pointId": row.point_id,
        "mediaId": row.media_id,
        "label": row.label,
        "capturedAt": row.captured_at,
        "timeCode": row.time_code,
        "origin": media.origin if media else "upload",
        "fileName": media.file_name if media else "",
        "size": media.size if media else 0,
        "mimeType": media.mime_type if media else "",
        "width": media.width if media else 0,
        "height": media.height if media else 0,
        "contentUrl": f"/api/v1/datasets/{dataset_id}/media/{row.media_id}/content",
    }


def _media_of(session: Session, dataset_id: str, media_id: str) -> MediaFile | None:
    return session.get(MediaFile, (dataset_id, media_id))


def register_frame(session: Session, workspace: Workspace, payload: dict) -> dict:
    point = _point(session, workspace, payload["pointId"])
    media = _media(session, workspace, payload["mediaId"])
    if media.point_id is not None and media.point_id != point.id:
        raise AppError("STATE_CONFLICT", "关键帧影像与测点不一致", 409)
    if not media.mime_type.startswith("image/"):
        raise AppError("VALIDATION_FAILED", "影像会话关键帧必须是图片", 422)
    row = MediaFrame(
        dataset_id=workspace.dataset_id,
        id=uid("mf"),
        media_id=media.id,
        point_id=point.id,
        video_id=None,
        time_code=payload.get("timeCode"),
        label=payload.get("label", ""),
        captured_at=payload.get("capturedAt") or media.uploaded_at,
    )
    session.add(row)
    session.flush()
    return _frame_out(row, workspace.dataset_id, media)


def list_frames(session: Session, workspace: Workspace, point_id: str | None) -> list[dict]:
    query = select(MediaFrame).where(MediaFrame.dataset_id == workspace.dataset_id)
    if point_id:
        _point(session, workspace, point_id)
        query = query.where(MediaFrame.point_id == point_id)
    rows = session.scalars(query.order_by(MediaFrame.captured_at))
    return [
        _frame_out(
            row, workspace.dataset_id, _media_of(session, workspace.dataset_id, row.media_id)
        )
        for row in rows
    ]


def save_comparison(session: Session, workspace: Workspace, payload: dict) -> dict:
    point = _point(session, workspace, payload["pointId"])
    before = _frame_of(session, workspace, payload["beforeId"])
    after = _frame_of(session, workspace, payload["afterId"])
    if before.point_id != point.id or after.point_id != point.id:
        raise AppError("STATE_CONFLICT", "比对关键帧与测点不一致", 409)
    result = payload.get("result") or {}
    row = MediaComparison(
        dataset_id=workspace.dataset_id,
        id=uid("mc"),
        point_id=point.id,
        before_id=before.id,
        after_id=after.id,
        result={
            "changedRatio": result.get("changedRatio"),
            "maxRegionRatio": result.get("maxRegionRatio"),
            "regions": result.get("regions"),
            "region": result.get("region"),
            "status": result.get("status"),
            "note": result.get("note", ""),
            "computedAt": result.get("computedAt"),
            "source": result.get("source", "session"),
        },
    )
    session.add(row)
    session.flush()
    return _comparison_out(session, row, workspace.dataset_id, before, after)


def _frame_of(session: Session, workspace: Workspace, frame_id: str) -> MediaFrame:
    row = session.get(MediaFrame, (workspace.dataset_id, frame_id))
    if row is None:
        raise AppError("NOT_FOUND", "关键帧不存在，请先登记会话影像", 404, {"frameId": frame_id})
    return row


def _comparison_out(
    session: Session, row: MediaComparison, dataset_id: str, before: MediaFrame, after: MediaFrame
) -> dict:
    return {
        "id": row.id,
        "pointId": row.point_id,
        "before": _frame_out(before, dataset_id, _media_of(session, dataset_id, before.media_id)),
        "after": _frame_out(after, dataset_id, _media_of(session, dataset_id, after.media_id)),
        "result": row.result,
    }


def list_comparisons(session: Session, workspace: Workspace, point_id: str | None) -> list[dict]:
    query = select(MediaComparison).where(MediaComparison.dataset_id == workspace.dataset_id)
    if point_id:
        _point(session, workspace, point_id)
        query = query.where(MediaComparison.point_id == point_id)
    rows = session.scalars(query.order_by(MediaComparison.id))
    out = []
    for row in rows:
        before = session.get(MediaFrame, (workspace.dataset_id, row.before_id))
        after = session.get(MediaFrame, (workspace.dataset_id, row.after_id))
        out.append(_comparison_out(session, row, workspace.dataset_id, before, after))
    return out


def session_summary(session: Session, workspace: Workspace, point_id: str | None) -> dict:
    frames = list_frames(session, workspace, point_id)
    comparisons = list_comparisons(session, workspace, point_id)
    latest = ""
    if point_id:
        rows = [
            row
            for row in session.scalars(
                select(MonitorRecord).where(
                    MonitorRecord.dataset_id == workspace.dataset_id,
                    MonitorRecord.point_id == point_id,
                )
            )
            if row.quality == "valid"
        ]
        if rows:
            latest = max(row.sample_time for row in rows)
    return {"frames": frames, "comparisons": comparisons, "latestSampleTime": latest}
