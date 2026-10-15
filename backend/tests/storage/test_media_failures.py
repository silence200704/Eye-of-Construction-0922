from concurrent.futures import ThreadPoolExecutor

import pytest
from conftest import demo_token
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from zhutong.core.settings import Settings
from zhutong.db.database import Database
from zhutong.db.media import SqlMediaRepository
from zhutong.db.models.foundation import AuditLog
from zhutong.db.models.media import Attachment, MediaFile

from .test_media import PNG, upload


def test_same_media_cannot_be_linked_twice(client: TestClient, database: Database) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    photo = upload(client, headers)
    body = {"mediaId": photo["id"], "draftId": "first", "issueId": "i1", "kind": "scene"}
    path = "/api/v1/datasets/demo-main/attachments"
    assert client.post(path, headers=headers, json=body).status_code == 201
    response = client.post(path, headers=headers, json={**body, "draftId": "second"})
    assert response.status_code == 409


def test_restricted_safety_identity_cannot_read_others_unlocated_uploads(client: TestClient, database: Database) -> None:
    inspector = {"Authorization": f"Bearer {demo_token(client, 'demo-inspector')}"}
    photo = client.post("/api/v1/datasets/demo-main/media?fileName=test.png", headers={**inspector, "Content-Type": "image/png"}, content=PNG).json()["data"]
    with database.engine.begin() as connection:
        connection.execute(text("UPDATE users SET building_ids_json='[\"b1\"]' WHERE id='demo-safety'"))
    restricted = {"Authorization": f"Bearer {demo_token(client)}"}
    assert client.get(photo["contentUrl"], headers=restricted).status_code == 403


def test_quota_and_acceptance_role_are_enforced(client: TestClient, database: Database) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client, 'demo-inspector')}"}
    path = "/api/v1/datasets/demo-main/attachments"
    for index in range(4):
        photo = upload(client, headers, **{"Idempotency-Key": f"photo-{index}"})
        body = {"mediaId": photo["id"], "draftId": f"draft-{index}", "issueId": "i1", "kind": "scene"}
        response = client.post(path, headers=headers, json=body)
        assert response.status_code == (201 if index < 3 else 422)
    rejected = client.post(path, headers=headers, json={**body, "kind": "acceptance"})
    assert rejected.status_code == 403
    with database.sessions() as session:
        assert len(session.scalars(select(Attachment)).all()) == 3
        assert {row.actor_id for row in session.scalars(select(AuditLog))} == {"demo-inspector"}


def test_failed_database_commit_removes_published_file(client: TestClient, database: Database, settings: Settings, monkeypatch: pytest.MonkeyPatch) -> None:
    original = SqlMediaRepository.save_file
    def fail_after_insert(self, context, record):
        original(self, context, record)
        self.db.execute(text("INSERT INTO datasets (id,name,kind,epoch,enabled,created_at) VALUES ('demo-main','duplicate','test',1,1,'now')"))
    monkeypatch.setattr(SqlMediaRepository, "save_file", fail_after_insert)
    client.raise_server_exceptions = False
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    response = client.post("/api/v1/datasets/demo-main/media?fileName=test.png", headers={**headers, "Content-Type": "image/png"}, content=PNG)
    assert response.status_code == 500
    with database.sessions() as session:
        assert session.scalars(select(MediaFile)).all() == []
        assert session.scalars(select(AuditLog)).all() == []
    assert not [path for path in (settings.runtime_dir / "media").rglob("*") if path.is_file()]


def test_parallel_uploads_share_one_committed_file(client: TestClient, database: Database, settings: Settings) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: upload(client, headers), range(2)))
    assert results[0]["id"] == results[1]["id"]
    with database.sessions() as session:
        assert len(session.scalars(select(MediaFile)).all()) == 1
    assert len([path for path in (settings.runtime_dir / "media" / "files").rglob("*") if path.is_file()]) == 1
