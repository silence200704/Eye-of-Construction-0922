"""S7-06 / S7-07：影像会话关键帧与比对结果持久化，恢复可重建 URL。"""

import base64

from fastapi.testclient import TestClient
from field.fixtures import token_of

from .fixtures import AssistantApi

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)


def _headers(api: AssistantApi, key: str) -> dict:
    return {
        "Authorization": f"Bearer {token_of(api.client, 'demo-safety')}",
        "Idempotency-Key": key,
        "X-Dataset-Epoch": str(api.epoch),
    }


def _upload(api: AssistantApi, point_id: str, key: str) -> dict:
    response = api.client.post(
        "/api/v1/datasets/demo-main/media",
        params={"fileName": "frame.png", "pointId": point_id},
        content=PNG,
        headers={**_headers(api, key), "Content-Type": "image/png"},
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["data"]


def _register(api: AssistantApi, body: dict, key: str):
    return api.client.post(
        "/api/v1/datasets/demo-main/media-sessions/frames",
        json=body,
        headers=_headers(api, key),
    )


def test_frame_registration_and_comparison_persist(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point_id = ids["point"]["id"]
    before = _upload(api, point_id, "media-session-before")
    after = _upload(api, point_id, "media-session-after")
    registered = _register(
        api,
        {
            "mediaId": before["id"],
            "pointId": point_id,
            "label": "处置前",
            "capturedAt": "2026-10-20T09:00:00+08:00",
        },
        "frame-before",
    )
    assert registered.status_code == 200, registered.text
    frame_before = registered.json()["data"]
    assert frame_before["contentUrl"].endswith(f"/media/{before['id']}/content")
    assert frame_before["origin"] == "upload"
    assert frame_before["width"] == 1 and frame_before["height"] == 1
    assert frame_before["fileName"] == "frame.png"
    after_registered = _register(
        api,
        {"mediaId": after["id"], "pointId": point_id, "label": "处置后"},
        "frame-after",
    )
    assert after_registered.status_code == 200, after_registered.text
    after_frame = after_registered.json()["data"]
    saved = api.client.post(
        "/api/v1/datasets/demo-main/media-sessions/comparisons",
        json={
            "pointId": point_id,
            "beforeId": frame_before["id"],
            "afterId": after_frame["id"],
            "result": {
                "changedRatio": 0.021,
                "maxRegionRatio": 0.018,
                "region": {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5},
                "status": "changed",
                "note": "像素差统计",
                "source": "session",
            },
        },
        headers=_headers(api, "compare-save"),
    )
    assert saved.status_code == 200, saved.text
    listing = api.get("/media-sessions/summary", pointId=point_id)
    assert len(listing["frames"]) == 2
    assert len(listing["comparisons"]) == 1
    assert listing["comparisons"][0]["result"]["changedRatio"] == 0.021
    content = api.client.get(
        f"/api/v1/datasets/demo-main/media/{before['id']}/content",
        headers={"Authorization": f"Bearer {token_of(api.client, 'demo-safety')}"},
    )
    assert content.status_code == 200
    assert content.content == PNG


def test_cross_point_frame_is_rejected(client: TestClient, settings) -> None:
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
            key="media-session-second",
        )
    )
    media = _upload(api, ids["point"]["id"], "media-session-cross")
    mismatch = _register(
        api,
        {"mediaId": media["id"], "pointId": other["id"]},
        "frame-cross",
    )
    assert mismatch.status_code == 409
    mine = _register(
        api,
        {"mediaId": media["id"], "pointId": ids["point"]["id"]},
        "frame-own",
    )
    assert mine.status_code == 200, mine.text
    second_media = _upload(api, other["id"], "media-session-cross-2")
    other_registered = _register(
        api,
        {"mediaId": second_media["id"], "pointId": other["id"]},
        "frame-cross-2",
    )
    assert other_registered.status_code == 200, other_registered.text
    other_frame = other_registered.json()["data"]
    cross_compare = api.client.post(
        "/api/v1/datasets/demo-main/media-sessions/comparisons",
        json={
            "pointId": ids["point"]["id"],
            "beforeId": mine.json()["data"]["id"],
            "afterId": other_frame["id"],
            "result": {"changedRatio": 0.5},
        },
        headers=_headers(api, "compare-cross"),
    )
    assert cross_compare.status_code == 409
