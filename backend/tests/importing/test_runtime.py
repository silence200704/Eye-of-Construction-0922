import base64
import struct

from conftest import demo_token
from fastapi.testclient import TestClient
from sqlalchemy import select

from zhutong.core.settings import Settings
from zhutong.db.database import Database
from zhutong.db.models.foundation import OperationReceipt, SessionState
from zhutong.db.models.media import MediaComparison, MediaFile, MediaFrame, MediaVideo

from .test_files import PNG
from .test_import import package


def test_runtime_video_frames_comparison_and_receipts_are_durable(
    client: TestClient, settings: Settings
) -> None:
    payload = package()
    png = "data:image/png;base64," + base64.b64encode(PNG).decode()
    mp4 = b"".join(struct.pack(">I4s", 8, kind) for kind in (b"ftyp", b"moov", b"mdat"))
    payload["runtime"]["video"] = {
        "meta": {
            "id": "video-old",
            "pointId": "legacy-p",
            "fileName": "old.mp4",
            "source": "原视频来源",
        },
        "analysis": {"reason": "人工说明"},
        "blob": "data:video/mp4;base64," + base64.b64encode(mp4).decode(),
    }
    payload["runtime"]["frames"] = [
        {
            "id": f"frame-{index}",
            "pointId": "legacy-p",
            "videoId": "video-old",
            "timeCode": index,
            "fileName": f"frame-{index}.png",
            "mimeType": "image/png",
            "origin": "video_frame",
            "capturedAt": "2026-09-01T10:00",
            "label": "原始关键帧",
            "blob": png,
        }
        for index in range(2)
    ]
    payload["runtime"]["comparisons"] = [
        {
            "pointId": "legacy-p",
            "beforeId": "frame-0",
            "afterId": "frame-1",
            "region": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
            "summary": "原比较结果",
        }
    ]
    payload["runtime"]["preferences"].append(
        {
            "key": "zhutong-demo/operation-receipts",
            "value": '[{"id":"receipt-old","actor":"历史人员","result":"创建"}]',
        }
    )
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    response = client.post("/api/v1/datasets/demo-main/imports", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    database = Database(settings.database_url)
    with database.sessions() as session:
        assert len(session.scalars(select(MediaFile)).all()) == 3
        assert len(session.scalars(select(MediaFrame)).all()) == 2
        assert session.scalar(select(MediaVideo)).analysis == {"reason": "人工说明"}
        assert session.scalar(select(MediaComparison)).result["summary"] == "原比较结果"
        assert "base64" not in str([row.state for row in session.scalars(select(SessionState))])
        assert session.scalar(select(OperationReceipt)).operation == "legacy-receipt"
    database.close()


def test_rule_identity_collision_is_reported_without_partial_commit(client: TestClient) -> None:
    payload = package()
    payload["data"]["rules"] = [
        {"id": "r1", "ruleId": "logical1", "code": "SAME"},
        {"id": "r2", "ruleId": "logical2", "code": "SAME"},
    ]
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    response = client.post(
        "/api/v1/datasets/demo-main/imports/preview", headers=headers, json=payload
    )
    assert response.status_code == 200
    assert response.json()["data"]["valid"] is False
    assert response.json()["data"]["errors"]
