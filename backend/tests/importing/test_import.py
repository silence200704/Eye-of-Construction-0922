import copy

from conftest import demo_token
from fastapi.testclient import TestClient
from sqlalchemy import select

from zhutong.core.settings import Settings
from zhutong.db.database import Database
from zhutong.db.models.foundation import ImportBatch


def package() -> dict:
    audit = {
        "createdAt": "2026-09-01T09:00",
        "createdBy": "历史录入员",
        "updatedAt": "2026-09-02T10:00",
        "updatedBy": "历史修改员",
    }
    return {
        "format": "zhutong-migration-v1",
        "schemaVersion": 7,
        "sourceName": "zhutong-demo",
        "data": {
            "buildings": [
                {
                    "id": "legacy-b",
                    "code": "BOLD",
                    "name": "旧楼",
                    "dataSource": "real",
                    "footprint": {"x": 0.1, "y": 0.2},
                    "unknownOriginalField": "不能丢失",
                    **audit,
                }
            ],
            "floors": [
                {"id": "legacy-f", "buildingId": "legacy-b", "floorNo": 2, "name": "二层", **audit}
            ],
            "points": [
                {
                    "id": "legacy-p",
                    "code": "POLD",
                    "name": "旧测点",
                    "buildingId": "legacy-b",
                    "floorId": "legacy-f",
                    "type": "crack",
                    "metric": "crack_width",
                    "coord": {"x": 0.3, "y": 0.4},
                    "dataSource": "real",
                    **audit,
                }
            ],
            "records": [
                {
                    "id": "legacy-r",
                    "recordNo": "ROLD",
                    "pointId": "legacy-p",
                    "deviceId": None,
                    "metric": "crack_width",
                    "values": {"width": 0.52},
                    "unit": "mm",
                    "sampleTime": "2026-09-03T09:12",
                    "enteredAt": "2026-09-04T12:13",
                    "enteredBy": "原始人员",
                    "enteredByRole": "device",
                    "source": "manual",
                    "quality": "valid",
                    "revision": 0,
                    "revisions": [],
                    "createdAt": "2026-09-04T12:13",
                }
            ],
        },
        "runtime": {
            "preferences": [
                {"key": "zhutong-demo/session", "value": '{"name":"原始人员","role":"device"}'}
            ],
            "assistant": {
                "turns": [
                    {"id": "turn-1", "question": "它怎么样", "result": {"status": "answered"}}
                ],
                "context": {"pointId": "legacy-p"},
            },
        },
    }


def test_preview_import_repeat_and_original_fields(client: TestClient, settings: Settings) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    path = "/api/v1/datasets/demo-main/imports"
    payload = package()
    preview = client.post(path + "/preview", headers=headers, json=payload)
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["valid"] is True
    database = Database(settings.database_url)
    with database.sessions() as session:
        assert session.scalars(select(ImportBatch)).all() == []
    result = client.post(path, headers=headers, json=payload)
    assert result.status_code == 201, result.text
    assert result.json()["data"]["tables"]["records"]["inserted"] == 1
    repeated = client.post(path, headers=headers, json={**payload, "exportedAt": "another-time"})
    assert repeated.status_code == 200
    assert repeated.json()["replayed"] is True
    assert repeated.json()["data"]["tables"]["records"] == {
        "source": 1,
        "inserted": 0,
        "matched": 1,
    }
    snapshot = client.get(path + "/snapshot", headers=headers).json()["data"]
    assert snapshot["data"]["records"] == payload["data"]["records"]
    assert snapshot["data"]["buildings"] == payload["data"]["buildings"]
    assert snapshot["runtimeCounts"]["session_states"] == 1
    database.close()


def test_invalid_references_and_collisions_do_not_partially_import(
    client: TestClient, settings: Settings
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    path = "/api/v1/datasets/demo-main/imports"
    bad = package()
    bad["data"]["points"][0]["floorId"] = "not-there"
    result = client.post(path, headers=headers, json=bad)
    assert result.status_code == 422
    assert result.json()["error"]["details"]["report"]["errors"]
    assert client.get(path + "/snapshot", headers=headers).json()["data"]["data"]["buildings"] == []
    assert client.post(path, headers=headers, json=package()).status_code == 201
    conflict = package()
    conflict["data"]["buildings"][0]["name"] = "不允许覆盖"
    response = client.post(path, headers=headers, json=conflict)
    assert response.status_code == 422
    snapshot = client.get(path + "/snapshot", headers=headers).json()["data"]
    assert snapshot["data"]["buildings"][0]["name"] == "旧楼"


def test_import_only_allows_safety_and_preserves_source_dataset(client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client, 'demo-inspector')}"}
    path = "/api/v1/datasets/demo-main/imports"
    assert client.post(path, headers=headers, json=package()).status_code == 403
    safety = {"Authorization": f"Bearer {demo_token(client)}"}
    for dataset in ("demo-main", "demo-showcase"):
        assert (
            client.post(
                f"/api/v1/datasets/{dataset}/imports", headers=safety, json=copy.deepcopy(package())
            ).status_code
            == 201
        )


def test_invalid_counts_and_newer_schema_are_reported(client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    for patch in [{"counts": {"records": 99}}, {"schemaVersion": 99}]:
        response = client.post(
            "/api/v1/datasets/demo-main/imports/preview",
            headers=headers,
            json={**package(), **patch},
        )
        assert response.status_code == 200
        assert response.json()["data"]["valid"] is False
