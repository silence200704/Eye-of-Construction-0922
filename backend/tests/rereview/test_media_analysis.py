"""复审 RR4/RR1：视频分析引用校验与重放权限。"""

from assistant.fixtures import AssistantApi
from fastapi.testclient import TestClient
from field.fixtures import PNG
from media.test_video_session import _register_video, _upload, mp4
from sqlalchemy import create_engine, text


def test_video_analysis_rejects_foreign_or_local_references(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point_id = ids["point"]["id"]
    media = _upload(api, point_id, "rereview-video", mp4(), "video/mp4")
    video = _register_video(api, media["id"], point_id, "rereview").json()["data"]
    frame_media = _upload(api, point_id, "rereview-frame", PNG, "image/png")
    frame = api.fpost(
        "/media-sessions/frames",
        {
            "mediaId": frame_media["id"],
            "pointId": point_id,
            "videoId": video["id"],
            "timeCode": 3.0,
        },
        "rereview-frame",
    ).json()["data"]
    body = {
        "analysis": {
            "videoId": video["id"],
            "pointId": point_id,
            "frameIds": [frame["id"]],
            "regions": {"crack": {"beforeId": frame["id"], "afterId": frame["id"]}},
            "reason": "预设区域统计",
        }
    }
    saved = api.fpost(f"/media-sessions/videos/{video['id']}/analysis", body, "rereview-analysis")
    assert saved.status_code == 200, saved.text
    analysis = saved.json()["data"]["analysis"]
    assert analysis["videoId"] == video["id"]
    assert analysis["frameIds"] == [frame["id"]]

    foreign = {"analysis": {**body["analysis"], "frameIds": ["mf_not_registered"]}}
    rejected = api.fpost(
        f"/media-sessions/videos/{video['id']}/analysis", foreign, "rereview-analysis-bad-frame"
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["error"]["code"] == "INVALID_ANALYSIS_REFERENCE"

    local = {"analysis": {**body["analysis"], "videoId": "video_local_1"}}
    local_result = api.fpost(
        f"/media-sessions/videos/{video['id']}/analysis", local, "rereview-analysis-local"
    )
    assert local_result.status_code == 422, local_result.text

    engine = create_engine(api.database_url)
    with engine.begin() as db:
        db.execute(text("UPDATE points SET status='archived' WHERE id=:id"), {"id": point_id})
    engine.dispose()
    replay = _register_video(api, media["id"], point_id, "rereview")
    assert replay.status_code == 404, replay.text
