"""返修回归：楼栋范围与跨目标幂等。"""

from fastapi.testclient import TestClient

from ..fixtures import Api, iso


def _extra_crack_point(api: Api) -> dict:
    building = api.ok(
        api.post(
            "/buildings",
            {
                "code": "B07",
                "name": "7号教学楼",
                "footprint": {"x": 0.2, "y": 0.2, "w": 0.1, "h": 0.1, "rotate": 0},
            },
            key="reg-b07",
        )
    )
    floor = api.ok(
        api.post(
            "/floors",
            {"buildingId": building["id"], "floorNo": 1, "name": "一层"},
            key="reg-b07-f1",
        )
    )
    point = api.ok(
        api.post(
            "/points",
            {
                "code": "B07-F1-CRACK01",
                "name": "范围外裂缝测点",
                "buildingId": building["id"],
                "floorId": floor["id"],
                "type": "crack",
                "coord": {"x": 0.5, "y": 0.5},
            },
            key="reg-b07-p1",
        )
    )
    return {"building": building, "floor": floor, "point": point}


def _scoped_headers(token: str, epoch: int, key: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "X-Dataset-Epoch": str(epoch),
        "Idempotency-Key": key,
    }


def test_record_revision_and_csv_enforce_building_scope(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    own = api.seed_crack()
    other = _extra_crack_point(api)
    outside_record = api.add_record(other["point"]["id"], 0.55, minutes=-60)
    scoped = api.add_scoped_user("demo-scope-records", [own["building"]["id"]])
    headers = _scoped_headers(scoped, api.epoch, "scope-record")

    denied = client.post(
        "/api/v1/datasets/demo-main/records",
        json={
            "pointId": other["point"]["id"],
            "values": {"width": 0.62},
            "unit": "mm",
            "sampleTime": iso(-30),
            "note": "越权补录",
        },
        headers=headers,
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "SCOPE_FORBIDDEN"

    denied_preview = client.post(
        "/api/v1/datasets/demo-main/assessments/preview",
        json={
            "pointId": other["point"]["id"],
            "values": {"width": 0.62},
            "unit": "mm",
            "sampleTime": iso(-30),
        },
        headers=headers,
    )
    assert denied_preview.status_code == 403

    denied_revision = client.post(
        f"/api/v1/datasets/demo-main/records/{outside_record['record']['id']}/revisions",
        json={
            "expectedRev": outside_record["record"]["rev"],
            "values": {"width": 0.56},
            "unit": "mm",
            "sampleTime": outside_record["record"]["sampleTime"],
            "reason": "越权修订",
        },
        headers=_scoped_headers(scoped, api.epoch, "scope-revision"),
    )
    assert denied_revision.status_code == 403

    csv_text = "\n".join(
        [
            "测点编号,采样时间,裂缝宽度,单位,统计窗口,质量标记,备注",
            f"{other['point']['code']},{iso(-20)},0.62,mm,,有效,越权导入",
        ]
    )
    preview_response = client.post(
        "/api/v1/datasets/demo-main/records/import-preview",
        json={"csvText": csv_text},
        headers=_scoped_headers(scoped, api.epoch, "scope-preview"),
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()["data"]
    assert preview["rows"][0]["payload"] is None
    assert "不存在" in "；".join(preview["rows"][0]["messages"])
    commit_response = client.post(
        "/api/v1/datasets/demo-main/records/import",
        json={"csvText": csv_text, "token": preview["token"], "lineNos": [2]},
        headers=_scoped_headers(scoped, api.epoch, "scope-import"),
    )
    assert commit_response.status_code == 422
    stored = [row for row in api.get("/records") if row["pointId"] == other["point"]["id"]]
    assert len(stored) == 1


def test_same_idempotency_key_cannot_replay_across_notifications(
    client: TestClient, settings
) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.62, minutes=-30)
    notes = api.get("/notifications")
    assert len(notes) == 2
    first, second = notes
    shared = "reg-same-key"
    api.ok(api.post(f"/notifications/{first['id']}/present", key=shared))
    conflict = api.post(f"/notifications/{second['id']}/present", key=shared)
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    stored = {row["id"]: row for row in api.get("/notifications")}
    assert stored[first["id"]]["presentedAt"] is not None
    assert stored[second["id"]]["presentedAt"] is None
    api.ok(api.post(f"/notifications/{second['id']}/present", key="reg-different-key"))
    assert {row["id"]: row for row in api.get("/notifications")}[second["id"]]["presentedAt"]
