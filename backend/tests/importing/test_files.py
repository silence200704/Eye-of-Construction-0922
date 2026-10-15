import base64
import copy

from conftest import demo_token
from fastapi.testclient import TestClient
from sqlalchemy import select

from zhutong.core.settings import Settings
from zhutong.db.database import Database
from zhutong.db.models.media import Attachment, MediaFile

from .test_import import package

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC")


def with_photo() -> dict:
    payload = package()
    data_url = "data:image/png;base64," + base64.b64encode(PNG).decode()
    payload["data"]["issues"] = [{"id": "legacy-i", "issueNo": "IOLD", "source": "report", "submissionKey": "legacy-submission", "pointId": "legacy-p", "buildingId": "legacy-b", "floorId": "legacy-f", "description": "原始问题描述", "photos": ["legacy-photo"], "status": "pending_review", "createdAt": "2026-09-05T10:00", "createdBy": "旧人员"}]
    payload["data"]["attachments"] = [{"id": "legacy-photo", "issueId": "legacy-i", "workOrderId": None, "maintenanceTaskId": None, "kind": "scene", "draftId": "legacy-draft", "fileName": "原始照片.png", "mimeType": "image/png", "size": len(PNG), "width": 1, "height": 1, "uploadedAt": "2026-09-05T10:00", "uploadedBy": "旧人员", "capturedAt": None, "blob": data_url, "thumb": data_url}]
    return payload


def test_files_are_preserved_outside_sqlite_and_verified(client: TestClient, settings: Settings) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    path = "/api/v1/datasets/demo-main/imports"
    payload = with_photo()
    preview = client.post(path + "/preview", headers=headers, json=payload)
    assert preview.json()["data"]["valid"] is True, preview.text
    assert not [p for p in (settings.runtime_dir / "media").rglob("*") if p.is_file()]
    result = client.post(path, headers=headers, json=payload)
    assert result.status_code == 201, result.text
    assert result.json()["data"]["filesVerified"] == 2
    database = Database(settings.database_url)
    with database.sessions() as session:
        photo = session.get(Attachment, ("demo-main", "legacy-photo"))
        media = session.get(MediaFile, ("demo-main", photo.media_id))
        assert (settings.runtime_dir / "media" / media.storage_key).read_bytes() == PNG
        assert media.legacy_payload["uploadedBy"] == "旧人员"
        assert "base64" not in str(photo.legacy_payload)
        assert len(session.scalars(select(MediaFile)).all()) == 2
    assert client.post(path, headers=headers, json=copy.deepcopy(payload)).json()["replayed"] is True
    database.close()


def test_broken_photos_block_import_with_an_explicit_report(client: TestClient, settings: Settings) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    payload = with_photo()
    payload["data"]["attachments"][0]["blob"] = {}
    result = client.post("/api/v1/datasets/demo-main/imports", headers=headers, json=payload)
    assert result.status_code == 422
    report = result.json()["error"]["details"]["report"]
    assert any(row["id"] == "legacy-photo" for row in report["errors"])
    assert not [p for p in (settings.runtime_dir / "media").rglob("*") if p.is_file()]


def test_nested_references_are_validated_before_commit(client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    payload = with_photo()
    payload["data"]["issues"][0]["photos"] = ["missing-photo"]
    response = client.post("/api/v1/datasets/demo-main/imports", headers=headers, json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["details"]["report"]["errors"]
