"""影像会话持久化：关键帧登记与比对结果，复用既有媒体表与授权。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Point
from ...db.models.media import MediaComparison, MediaFile, MediaFrame, MediaVideo
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
        "videoId": row.video_id,
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
    video_id = payload.get("videoId")
    if video_id is not None:
        video = session.get(MediaVideo, (workspace.dataset_id, str(video_id)))
        if video is None or video.point_id != point.id:
            raise AppError("STATE_CONFLICT", "关键帧视频与测点不一致", 409)
    row = MediaFrame(
        dataset_id=workspace.dataset_id,
        id=uid("mf"),
        media_id=media.id,
        point_id=point.id,
        video_id=str(video_id) if video_id is not None else None,
        time_code=payload.get("timeCode"),
        label=payload.get("label", ""),
        captured_at=payload.get("capturedAt") or media.uploaded_at,
    )
    session.add(row)
    session.flush()
    return _frame_out(row, workspace.dataset_id, media)


def _visible_frame_parts(
    session: Session, workspace: Workspace, row: MediaFrame
) -> tuple[Point, MediaFile] | None:
    point = session.get(Point, (workspace.dataset_id, row.point_id))
    if (
        point is None
        or point.status != "active"
        or not can_access_building(workspace, point.building_id)
    ):
        return None
    media = _media_of(session, workspace.dataset_id, row.media_id)
    if media is None or (media.point_id is not None and media.point_id != point.id):
        return None
    media_point = (
        session.get(Point, (workspace.dataset_id, media.point_id)) if media.point_id else None
    )
    if not _media_readable(workspace, media, media_point):
        return None
    return point, media


def _point_visible(session: Session, workspace: Workspace, point_id: str | None) -> Point | None:
    if not point_id:
        return None
    point = session.get(Point, (workspace.dataset_id, point_id))
    if (
        point is None
        or point.status != "active"
        or not can_access_building(workspace, point.building_id)
    ):
        return None
    return point


def _video_out(session: Session, row: MediaVideo, dataset_id: str) -> dict:
    return {
        "id": row.id,
        "pointId": row.point_id,
        "mediaId": row.media_id,
        "metadata": row.metadata_snapshot or {},
        "analysis": row.analysis,
        "contentUrl": f"/api/v1/datasets/{dataset_id}/media/{row.media_id}/content",
    }


def _replay_frame(session: Session, workspace: Workspace, frame_id: str) -> None:
    row = session.get(MediaFrame, (workspace.dataset_id, frame_id))
    if row is None or _point_visible(session, workspace, row.point_id) is None:
        raise AppError("NOT_FOUND", "该关键帧不存在或无权读取", 404, {"frameId": frame_id})
    if _visible_frame_parts(session, workspace, row) is None:
        raise AppError("ROLE_FORBIDDEN", "无权读取该媒体", 403, {"frameId": frame_id})


def replay_visible(session: Session, workspace: Workspace, data: dict, kind: str) -> None:
    """幂等重放不重办业务，但按当前媒体所有权重新检查依赖对象。"""
    if kind == "frame":
        _replay_frame(session, workspace, str(data["id"]))
        return
    if kind == "comparison":
        row = session.get(MediaComparison, (workspace.dataset_id, str(data["id"])))
        if row is None or _point_visible(session, workspace, row.point_id) is None:
            raise AppError("NOT_FOUND", "该比对不存在或无权读取", 404)
        _replay_frame(session, workspace, row.before_id)
        _replay_frame(session, workspace, row.after_id)
        return
    row = session.get(MediaVideo, (workspace.dataset_id, str(data["id"])))
    point = _point_visible(session, workspace, row.point_id) if row is not None else None
    if row is None or point is None:
        raise AppError("NOT_FOUND", "该视频不存在或无权读取", 404)
    media = _media_of(session, workspace.dataset_id, row.media_id)
    if media is None or not _media_readable(workspace, media, point):
        raise AppError("ROLE_FORBIDDEN", "无权读取该视频媒体", 403)


def register_video(session: Session, workspace: Workspace, payload: dict) -> dict:
    point = _point(session, workspace, payload["pointId"])
    media = _media(session, workspace, payload["mediaId"])
    if media.point_id != point.id or media.mime_type != "video/mp4":
        raise AppError("STATE_CONFLICT", "视频媒体与测点不一致，且必须是 MP4", 409)
    row = session.scalar(
        select(MediaVideo).where(
            MediaVideo.dataset_id == workspace.dataset_id,
            MediaVideo.media_id == media.id,
        )
    )
    metadata = payload.get("metadata") or {}
    if row is None:
        row = MediaVideo(
            dataset_id=workspace.dataset_id,
            id=uid("mv"),
            media_id=media.id,
            point_id=point.id,
            metadata_snapshot=metadata,
            analysis=None,
        )
        session.add(row)
    elif row.point_id != point.id or row.metadata_snapshot != metadata:
        raise AppError("STATE_CONFLICT", "该视频已绑定其它测点或元数据", 409)
    session.flush()
    return _video_out(session, row, workspace.dataset_id)


def _analysis_frames(
    session: Session, workspace: Workspace, row: MediaVideo, analysis: dict
) -> None:
    frame_ids = analysis.get("frameIds")
    if frame_ids is None:
        frame_ids = []
    if not isinstance(frame_ids, list) or not all(isinstance(item, str) for item in frame_ids):
        raise AppError("INVALID_ANALYSIS_REFERENCE", "视频分析的关键帧引用格式无效", 422)
    known: set[str] = set()
    for frame_id in frame_ids:
        frame = session.get(MediaFrame, (workspace.dataset_id, frame_id))
        if frame is None or frame.video_id != row.id or frame.point_id != row.point_id:
            raise AppError(
                "INVALID_ANALYSIS_REFERENCE",
                "视频分析引用了不属于该视频/测点的关键帧",
                422,
                {"frameId": frame_id},
            )
        known.add(frame_id)
    regions = analysis.get("regions") or {}
    if not isinstance(regions, dict):
        raise AppError("INVALID_ANALYSIS_REFERENCE", "视频分析区域必须是对象", 422)
    for region in regions.values():
        if not isinstance(region, dict):
            continue
        for key in ("beforeId", "afterId"):
            ref = region.get(key)
            if ref is not None and ref not in known:
                raise AppError(
                    "INVALID_ANALYSIS_REFERENCE",
                    "视频分析区域引用了未登记的关键帧",
                    422,
                    {"regionKey": key, "frameId": ref},
                )


def save_video_analysis(session: Session, workspace: Workspace, payload: dict) -> dict:
    row = session.get(MediaVideo, (workspace.dataset_id, payload["videoId"]))
    point = _point_visible(session, workspace, row.point_id) if row is not None else None
    if row is None or point is None:
        raise AppError("NOT_FOUND", "视频不存在或无权读取", 404, {"videoId": payload["videoId"]})
    analysis = payload.get("analysis")
    if not isinstance(analysis, dict):
        raise AppError("VALIDATION_FAILED", "视频分析结果必须是结构化对象", 422)
    if analysis.get("videoId") not in (None, row.id):
        raise AppError("INVALID_ANALYSIS_REFERENCE", "分析结果绑定了另一个视频", 422)
    if analysis.get("pointId") not in (None, row.point_id):
        raise AppError("INVALID_ANALYSIS_REFERENCE", "分析结果绑定了另一个测点", 422)
    _analysis_frames(session, workspace, row, analysis)
    row.analysis = {**analysis, "videoId": row.id, "pointId": row.point_id}
    session.flush()
    return _video_out(session, row, workspace.dataset_id)


def list_videos(session: Session, workspace: Workspace, point_id: str | None) -> list[dict]:
    query = select(MediaVideo).where(MediaVideo.dataset_id == workspace.dataset_id)
    if point_id:
        _point(session, workspace, point_id)
        query = query.where(MediaVideo.point_id == point_id)
    out = []
    for row in session.scalars(query.order_by(MediaVideo.id)):
        if _point_visible(session, workspace, row.point_id) is None:
            continue
        out.append(_video_out(session, row, workspace.dataset_id))
    return out


def list_frames(session: Session, workspace: Workspace, point_id: str | None) -> list[dict]:
    query = select(MediaFrame).where(MediaFrame.dataset_id == workspace.dataset_id)
    if point_id:
        _point(session, workspace, point_id)
        query = query.where(MediaFrame.point_id == point_id)
    rows = session.scalars(query.order_by(MediaFrame.captured_at))
    out = []
    for row in rows:
        parts = _visible_frame_parts(session, workspace, row)
        if parts is not None:
            out.append(_frame_out(row, workspace.dataset_id, parts[1]))
    return out


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
        if before is None or after is None:
            continue
        if _visible_frame_parts(session, workspace, before) is None:
            continue
        if _visible_frame_parts(session, workspace, after) is None:
            continue
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
    return {
        "frames": frames,
        "comparisons": comparisons,
        "videos": list_videos(session, workspace, point_id),
        "latestSampleTime": latest,
    }
