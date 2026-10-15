import base64

from conftest import demo_token
from fastapi.testclient import TestClient
from sqlalchemy import select

from zhutong.app import create_app
from zhutong.core.settings import Settings
from zhutong.db.database import Database
from zhutong.db.models.media import Attachment, MediaFile

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)


def upload(client: TestClient, headers: dict, **changes) -> dict:
    response = client.post(
        "/api/v1/datasets/demo-main/media?fileName=现场.png&pointId=p1",
        headers={
            **headers,
            "Content-Type": "image/png",
            "Idempotency-Key": "photo-draft-1",
            **changes,
        },
        content=PNG,
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["data"]


def test_upload_is_validated_persistent_and_idempotent(
    client: TestClient, database: Database, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    first, second = upload(client, headers), upload(client, headers)
    assert first["id"] == second["id"]
    assert first["width"] == first["height"] == 1
    assert "storageKey" not in first
    with database.sessions() as session:
        assert len(session.scalars(select(MediaFile)).all()) == 1
    with TestClient(create_app(settings)) as restarted:
        response = restarted.get(first["contentUrl"], headers=headers)
        assert response.status_code == 200
        assert response.content == PNG
        assert response.headers["Content-Type"] == "image/png"


def test_bad_mime_invalid_bytes_and_size_leave_no_files(
    client: TestClient, database: Database, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    settings.media_max_bytes = 100
    for mime, data, status in [
        ("text/html", PNG, 415),
        ("image/jpeg", PNG, 415),
        ("image/png", b"fake-image", 422),
        ("image/png", PNG * 3, 413),
    ]:
        response = client.post(
            "/api/v1/datasets/demo-main/media?fileName=test.png",
            headers={**headers, "Content-Type": mime},
            content=data,
        )
        assert response.status_code == status, response.text
    with database.sessions() as session:
        assert session.scalars(select(MediaFile)).all() == []
    assert not list((settings.runtime_dir / "media").rglob("*.part"))


def test_attachment_has_one_real_owner_and_cannot_cross_datasets(
    client: TestClient, database: Database
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    photo = upload(client, headers)
    body = {"mediaId": photo["id"], "issueId": "i1", "kind": "scene", "draftId": "draft-one"}
    path = "/api/v1/datasets/demo-main/attachments"
    good = client.post(path, headers=headers, json=body)
    assert good.status_code == 201, good.text
    replay = client.post(path, headers=headers, json=body)
    assert replay.json()["data"]["id"] == good.json()["data"]["id"]
    for changes in [{"issueId": "missing"}, {"workOrderId": "missing"}, {"issueId": None}]:
        rejected = client.post(path, headers=headers, json={**body, "draftId": "bad", **changes})
        assert rejected.status_code in (404, 422)
    assert (
        client.post(
            "/api/v1/datasets/demo-showcase/attachments", headers=headers, json=body
        ).status_code
        == 404
    )
    with database.sessions() as session:
        assert len(session.scalars(select(Attachment)).all()) == 1


def test_upload_and_download_require_server_identity(
    client: TestClient, database: Database
) -> None:
    path = "/api/v1/datasets/demo-main/media?fileName=test.png"
    assert client.post(path, content=PNG, headers={"Content-Type": "image/png"}).status_code == 401
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    photo = upload(client, headers)
    assert client.get(photo["contentUrl"]).status_code == 401
    assert (
        client.get(
            "/api/v1/datasets/demo-showcase/media/" + photo["id"] + "/content", headers=headers
        ).status_code
        == 404
    )
