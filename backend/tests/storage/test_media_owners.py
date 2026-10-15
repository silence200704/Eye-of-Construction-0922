from conftest import demo_token
from fastapi.testclient import TestClient
from sqlalchemy import insert, select, text

from zhutong.core.settings import Settings
from zhutong.db.database import Database
from zhutong.db.models.archive import Device
from zhutong.db.models.field import MaintenancePlan, MaintenanceTask, WorkOrder
from zhutong.db.models.media import MediaFile

from .test_media import PNG, upload


def test_work_order_and_maintenance_photos_use_real_owners(
    client: TestClient, database: Database
) -> None:
    with database.sessions.begin() as session:
        session.execute(
            insert(Device),
            {
                "dataset_id": "demo-main",
                "id": "d1",
                "code": "D01",
                "name": "设备",
                "point_id": "p1",
            },
        )
        session.execute(
            insert(MaintenancePlan),
            {
                "dataset_id": "demo-main",
                "id": "mp1",
                "code": "MP01",
                "name": "保养",
                "device_id": "d1",
                "point_id": "p1",
                "building_id": "b1",
                "cycle": {},
                "start_date": "2026-10-15",
                "owner": "负责人",
                "checklist": [],
            },
        )
        session.execute(
            insert(MaintenanceTask),
            {
                "dataset_id": "demo-main",
                "id": "mt1",
                "task_no": "MT01",
                "plan_id": "mp1",
                "device_id": "d1",
                "planned_at": "2026-10-15",
                "due_at": "2026-10-16",
                "snapshot": {"buildingId": "b1", "pointId": "p1"},
            },
        )
        session.execute(
            insert(WorkOrder),
            {
                "dataset_id": "demo-main",
                "id": "wo1",
                "order_no": "WO01",
                "origin": "issue",
                "issue_id": "i1",
                "title": "维修",
            },
        )
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    for index, owner in enumerate([{"workOrderId": "wo1"}, {"maintenanceTaskId": "mt1"}]):
        photo = upload(client, headers, **{"Idempotency-Key": f"owner-photo-{index}"})
        response = client.post(
            "/api/v1/datasets/demo-main/attachments",
            headers=headers,
            json={"mediaId": photo["id"], "draftId": f"owner-{index}", "kind": "scene", **owner},
        )
        assert response.status_code == 201, response.text


def test_changed_idempotency_payload_and_wrong_scope_are_rejected(
    client: TestClient, database: Database
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    photo = upload(client, headers)
    changed = client.post(
        "/api/v1/datasets/demo-main/media?fileName=another.png&pointId=p1",
        headers={**headers, "Content-Type": "image/png", "Idempotency-Key": "photo-draft-1"},
        content=PNG,
    )
    assert changed.status_code == 409
    assert (
        client.get("/api/v1/datasets/demo-main/media/" + photo["id"], headers=headers).status_code
        == 200
    )
    with database.engine.begin() as connection:
        connection.execute(text("UPDATE users SET building_ids_json='[]' WHERE id='demo-safety'"))
    assert client.get(photo["contentUrl"], headers=headers).status_code == 403
    assert (
        client.post(
            "/api/v1/datasets/demo-main/media?fileName=scope.png&pointId=p1",
            headers={**headers, "Content-Type": "image/png"},
            content=PNG,
        ).status_code
        == 403
    )


def test_corrupt_missing_files_and_unsafe_names_are_explicit(
    client: TestClient, database: Database, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    photo = upload(client, headers)
    with database.sessions() as session:
        record = session.scalar(select(MediaFile))
        path = settings.runtime_dir / "media" / record.storage_key
    path.write_bytes(b"tampered")
    assert client.get(photo["contentUrl"], headers=headers).status_code == 409
    path.unlink()
    assert client.get(photo["contentUrl"], headers=headers).status_code == 404
    assert (
        client.post(
            "/api/v1/datasets/demo-main/media?fileName=../escape.png",
            headers={**headers, "Content-Type": "image/png"},
            content=PNG,
        ).status_code
        == 422
    )
