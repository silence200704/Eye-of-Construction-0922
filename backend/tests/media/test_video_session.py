"""R8：视频原字节、元数据、关键帧、分析结果与来源标记的持久化。"""

import struct

from assistant.fixtures import AssistantApi
from fastapi.testclient import TestClient
from field.fixtures import PNG


def mp4() -> bytes:
    """最小合法 MP4 容器：验证服务端存储与元数据，不替代前端真实解码。"""

    def box(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", 8 + len(payload)) + kind + payload

    return (
        box(b"ftyp", b"isom\x00\x00\x02\x00isomiso2")
        + box(b"moov", b"")
        + box(b"mdat", b"\x00" * 16)
    )


def _upload(
    api: AssistantApi, point_id: str, key: str, data: bytes, mime: str, origin: str | None = None
) -> dict:
    params = {"fileName": f"{key}.{'mp4' if mime == 'video/mp4' else 'png'}", "pointId": point_id}
    if origin:
        params["origin"] = origin
    response = api.client.post(
        "/api/v1/datasets/demo-main/media",
        params=params,
        content=data,
        headers={
            **api.headers(key=f"media-{key}"),
            "Content-Type": mime,
        },
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["data"]


def _register_video(api: AssistantApi, media_id: str, point_id: str, key: str):
    return api.fpost(
        "/media-sessions/videos",
        {
            "mediaId": media_id,
            "pointId": point_id,
            "metadata": {
                "fileName": "演示.mp4",
                "title": "固定机位演示",
                "source": "随包演示素材",
                "assetKey": "change",
                "comparable": True,
                "note": "合成演示视频，非真实连续拍摄",
            },
        },
        f"video-{key}",
    )


def test_video_metadata_analysis_frames_and_summary_persist(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point_id = ids["point"]["id"]
    video_media = _upload(api, point_id, "video", mp4(), "video/mp4")
    assert video_media["origin"] == "upload"
    registered = _register_video(api, video_media["id"], point_id, "one")
    assert registered.status_code == 200, registered.text
    video = registered.json()["data"]
    assert video["metadata"]["assetKey"] == "change"
    assert video["contentUrl"].endswith(f"/media/{video_media['id']}/content")
    replay = _register_video(api, video_media["id"], point_id, "one")
    assert replay.json()["data"]["id"] == video["id"]
    assert replay.json()["replayed"] is True
    changed = api.fpost(
        "/media-sessions/videos",
        {
            "mediaId": video_media["id"],
            "pointId": point_id,
            "metadata": {"assetKey": "different"},
        },
        "video-one",
    )
    assert changed.status_code == 409, changed.text

    analysis = api.fpost(
        f"/media-sessions/videos/{video['id']}/analysis",
        {
            "analysis": {
                "videoId": video["id"],
                "pointId": point_id,
                "frameIds": [],
                "regions": {},
                "reason": "合成演示视频，非真实连续拍摄",
            }
        },
        "video-analysis-one",
    )
    assert analysis.status_code == 200, analysis.text
    replay_analysis = api.fpost(
        f"/media-sessions/videos/{video['id']}/analysis",
        {
            "analysis": {
                "videoId": video["id"],
                "pointId": point_id,
                "frameIds": [],
                "regions": {},
                "reason": "合成演示视频，非真实连续拍摄",
            }
        },
        "video-analysis-one",
    )
    assert replay_analysis.status_code == 200, replay_analysis.text
    assert replay_analysis.json()["replayed"] is True

    frame_media = _upload(api, point_id, "frame", PNG, "image/png", origin="demo_generated")
    frame = api.fpost(
        "/media-sessions/frames",
        {
            "mediaId": frame_media["id"],
            "pointId": point_id,
            "videoId": video["id"],
            "timeCode": 3.0,
        },
        "video-frame-one",
    ).json()["data"]
    assert frame["origin"] == "demo_generated"
    assert frame["videoId"] == video["id"]
    summary = api.get("/media-sessions/summary", pointId=point_id)
    assert [row["id"] for row in summary["videos"]] == [video["id"]]
    assert summary["videos"][0]["analysis"]["reason"].startswith("合成演示")
    assert summary["frames"][0]["videoId"] == video["id"]
    content = api.client.get(
        f"/api/v1/datasets/demo-main/media/{video_media['id']}/content", headers=api.auth()
    )
    assert content.status_code == 200
    assert content.content == mp4()


def test_video_scope_and_cross_point_are_enforced(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    other = api.ok(
        api.post(
            "/points",
            {
                "code": "B03-F2-CRACK02",
                "name": "第二裂缝测点",
                "buildingId": ids["building"]["id"],
                "floorId": ids["floor"]["id"],
                "type": "crack",
                "coord": {"x": 0.6, "y": 0.6},
            },
            key="video-other-point",
        )
    )
    video_media = _upload(api, ids["point"]["id"], "scope-video", mp4(), "video/mp4")
    registered = _register_video(api, video_media["id"], ids["point"]["id"], "scope")
    assert registered.status_code == 200, registered.text
    foreign = _upload(api, other["id"], "foreign-video", mp4(), "video/mp4")
    mismatch = api.fpost(
        "/media-sessions/videos",
        {"mediaId": foreign["id"], "pointId": ids["point"]["id"], "metadata": {}},
        "video-mismatch",
    )
    assert mismatch.status_code == 409, mismatch.text
    api.add_scoped_user("review-video-scope", [], role="safety")
    listing = api.client.get(
        "/api/v1/datasets/demo-main/media-sessions/videos",
        headers={"Authorization": f"Bearer {api.token_for('review-video-scope')}"},
    )
    assert listing.status_code == 200
    assert listing.json()["data"] == []
    summary = api.client.get(
        "/api/v1/datasets/demo-main/media-sessions/summary",
        headers={"Authorization": f"Bearer {api.token_for('review-video-scope')}"},
    )
    assert summary.status_code == 200
    assert summary.json()["data"]["videos"] == []
