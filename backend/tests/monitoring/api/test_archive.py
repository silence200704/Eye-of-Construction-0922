"""S4-01 / S4-06 / S4-11：档案持久化、校验、范围与幂等。"""

from fastapi.testclient import TestClient

from ..fixtures import Api, iso


def test_archive_roundtrip_and_revision(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    listed = api.get("/archive")
    assert [row["code"] for row in listed["buildings"]] == ["B03"]
    assert listed["points"][0]["coord"] == {"x": 0.5, "y": 0.5}
    assert listed["points"][0]["nfc"]["code"] == "NFC-CRACK-01"
    assert listed["rules"][0]["ruleId"] == ids["rule"]["ruleId"]
    assert listed["baselines"][0]["version"] == 1

    updated = api.patch(
        f"/buildings/{ids['building']['id']}",
        {
            "expectedRev": ids["building"]["rev"],
            "code": "B03",
            "name": "3号教学楼（北区）",
            "footprint": {"x": 0.4, "y": 0.6, "w": 0.2, "h": 0.2, "rotate": 0},
        },
    )
    assert updated["name"] == "3号教学楼（北区）"
    assert updated["rev"] == ids["building"]["rev"] + 1
    stale = client.patch(
        f"/api/v1/datasets/demo-main/buildings/{ids['building']['id']}",
        json={
            "expectedRev": ids["building"]["rev"],
            "code": "B03",
            "name": "旧副本覆盖",
            "footprint": {"x": 0.4, "y": 0.6, "w": 0.2, "h": 0.2, "rotate": 0},
        },
        headers=api.headers(),
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "REVISION_CONFLICT"
    assert api.get("/archive")["buildings"][0]["name"] == "3号教学楼（北区）"


def test_invalid_floor_coordinate_and_duplicate_nfc_rejected(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    other = api.ok(
        api.post(
            "/buildings",
            {
                "code": "B04",
                "name": "体育馆",
                "footprint": {"x": 0.7, "y": 0.6, "w": 0.1, "h": 0.1, "rotate": 0},
            },
            key="b04",
        )
    )
    other_floor = api.ok(
        api.post(
            "/floors",
            {"buildingId": other["id"], "floorNo": 1, "name": "一层"},
            key="b04-f1",
        )
    )
    wrong_floor = api.post(
        "/points",
        {
            "code": "B03-F2-CRACK02",
            "name": "错楼层测点",
            "buildingId": ids["building"]["id"],
            "floorId": other_floor["id"],
            "type": "crack",
            "coord": {"x": 0.5, "y": 0.5},
        },
        key="wrong-floor",
    )
    assert wrong_floor.status_code == 422
    assert wrong_floor.json()["error"]["code"] == "INVALID_FLOOR"

    bad_coord = api.post(
        "/points",
        {
            "code": "B03-F2-CRACK03",
            "name": "越界测点",
            "buildingId": ids["building"]["id"],
            "floorId": ids["floor"]["id"],
            "type": "crack",
            "coord": {"x": 1.2, "y": 0.5},
        },
        key="bad-coord",
    )
    assert bad_coord.status_code == 422
    assert bad_coord.json()["error"]["code"] == "INVALID_COORDINATE"

    duplicate = api.post(
        "/points",
        {
            "code": "B03-F2-CRACK04",
            "name": "标签冲突测点",
            "buildingId": ids["building"]["id"],
            "floorId": ids["floor"]["id"],
            "type": "crack",
            "coord": {"x": 0.6, "y": 0.5},
            "nfcLabel": "NFC-CRACK-01",
        },
        key="duplicate-nfc",
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "DUPLICATE_NFC"


def test_archive_point_cascades_devices_and_blocks_new_records(
    client: TestClient, settings
) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    archived = api.ok(
        api.post(
            f"/archive/{ids['point']['id']}/archive",
            {
                "kind": "point",
                "expectedRev": ids["point"]["rev"],
                "reason": "测点拆除",
            },
            key="archive-point",
        )
    )
    assert archived["status"] == "archived"
    points = api.get("/archive")["points"]
    assert points[0]["status"] == "archived"
    devices = api.get("/archive")["devices"]
    assert devices[0]["status"] == "archived"
    blocked = api.post(
        "/records",
        {
            "pointId": ids["point"]["id"],
            "values": {"width": 0.62},
            "unit": "mm",
            "sampleTime": "2026-09-01T09:00:00Z",
            "note": "历史补录",
        },
    )
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "STATE_CONFLICT"


def test_idempotent_replay_and_conflict(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    body = {
        "code": "B05",
        "name": "5号教学楼",
        "footprint": {"x": 0.3, "y": 0.3, "w": 0.1, "h": 0.1, "rotate": 0},
    }
    first = api.post("/buildings", body, key="same-key")
    assert first.status_code == 200
    replay = api.post("/buildings", body, key="same-key")
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert replay.json()["data"]["id"] == first.json()["data"]["id"]
    assert len(api.get("/archive")["buildings"]) == 1
    conflict = api.post("/buildings", {**body, "name": "另一个楼栋"}, key="same-key")
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"


def test_epoch_required_and_stale_epoch_rejected(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    body = {
        "code": "B06",
        "name": "6号教学楼",
        "footprint": {"x": 0.3, "y": 0.3, "w": 0.1, "h": 0.1, "rotate": 0},
    }
    missing = client.post(
        "/api/v1/datasets/demo-main/buildings",
        json=body,
        headers={**api.auth(), "Idempotency-Key": "no-epoch"},
    )
    assert missing.status_code == 400
    assert missing.json()["error"]["code"] == "DATASET_EPOCH_REQUIRED"
    stale = api.post("/buildings", body, key="stale", epoch=api.epoch + 1)
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "DATASET_EPOCH_CONFLICT"
    assert api.get("/archive")["buildings"] == []


def test_role_and_building_scope_enforced(client: TestClient, settings) -> None:
    safety = Api(client, str(settings.database_url))
    ids = safety.seed_crack()
    other = safety.ok(
        safety.post(
            "/buildings",
            {
                "code": "B07",
                "name": "7号教学楼",
                "footprint": {"x": 0.2, "y": 0.2, "w": 0.1, "h": 0.1, "rotate": 0},
            },
            key="b07",
        )
    )
    other_floor = safety.ok(
        safety.post(
            "/floors",
            {"buildingId": other["id"], "floorNo": 1, "name": "一层"},
            key="b07-f1",
        )
    )
    inspector = Api(client, str(settings.database_url), account="demo-inspector")
    forbidden = inspector.post(
        "/buildings",
        {
            "code": "B08",
            "name": "越权楼栋",
            "footprint": {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1, "rotate": 0},
        },
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "ROLE_FORBIDDEN"

    scoped_token = safety.add_scoped_user("demo-scoped", [ids["building"]["id"]])
    scoped_headers = {
        "Authorization": f"Bearer {scoped_token}",
        "X-Dataset-Epoch": str(safety.epoch),
        "Idempotency-Key": "scoped-point",
    }
    outside = client.post(
        "/api/v1/datasets/demo-main/points",
        json={
            "code": "B07-F1-CRACK01",
            "name": "范围外测点",
            "buildingId": other["id"],
            "floorId": other_floor["id"],
            "type": "crack",
            "coord": {"x": 0.5, "y": 0.5},
        },
        headers=scoped_headers,
    )
    assert outside.status_code == 403
    assert outside.json()["error"]["code"] == "SCOPE_FORBIDDEN"


def test_forged_actor_and_cross_dataset_access_rejected(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    forged = api.post(
        "/buildings",
        {
            "code": "B09",
            "name": "伪造身份楼栋",
            "actor": {"name": "别人", "role": "safety"},
            "footprint": {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1, "rotate": 0},
        },
    )
    assert forged.status_code == 422
    assert forged.json()["error"]["code"] == "VALIDATION_FAILED"

    cross = client.patch(
        f"/api/v1/datasets/demo-showcase/buildings/{ids['building']['id']}",
        json={
            "expectedRev": ids["building"]["rev"],
            "code": "B03",
            "name": "跨数据集覆盖",
            "footprint": {"x": 0.4, "y": 0.6, "w": 0.2, "h": 0.2, "rotate": 0},
        },
        headers=api.headers(),
    )
    assert cross.status_code == 404
    assert cross.json()["error"]["code"] == "NOT_FOUND"


def rule_body(threshold: float) -> dict:
    return {
        "code": "RULE-CRACK-001",
        "name": "裂缝宽度变化分级规则",
        "metric": "crack_width",
        "unit": "mm",
        "thresholds": {"yellow": threshold, "orange": 0.2, "red": 0.3},
        "persistence": {
            "minRecords": 3,
            "minSpanMinutes": 10,
            "maxGapMinutes": 5,
            "level": "orange",
        },
        "recovery": {"yellowRatio": 0.8, "minRecords": 3, "minSpanMinutes": 0},
        "source": "测试规则",
    }


def test_rule_update_creates_version_and_keeps_history(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    before = api.add_record(ids["point"]["id"], 0.62, minutes=-70)
    assert before["record"]["ruleVersion"] == "V1.0"
    assert before["assessment"]["state"] == "yellow"

    latest = api.get("/archive")["rules"][0]
    updated = api.ok(
        api.post(
            f"/rules/{latest['ruleId']}/versions",
            {
                **rule_body(0.15),
                "effectiveFrom": iso(-30),
                "expectedRev": latest["rev"],
                "expectedVersion": latest["version"],
            },
            key="rule-v2",
        )
    )
    assert updated["version"] == "V1.1"
    assert updated["thresholds"]["yellow"] == 0.15
    versions = sorted(
        (row for row in api.get("/archive")["rules"] if row["ruleId"] == latest["ruleId"]),
        key=lambda row: row["version"],
    )
    assert [row["version"] for row in versions] == ["V1.0", "V1.1"]
    assert versions[0]["thresholds"]["yellow"] == 0.1

    after = api.add_record(ids["point"]["id"], 0.62, minutes=-10)
    assert after["record"]["ruleVersion"] == "V1.1"
    assert after["assessment"]["state"] == "normal"
    stored = {row["id"]: row for row in api.get("/records")}
    assert stored[before["record"]["id"]]["ruleVersion"] == "V1.0"

    stale = api.post(
        f"/rules/{latest['ruleId']}/versions",
        {
            **rule_body(0.2),
            "expectedRev": latest["rev"],
            "expectedVersion": "V1.0",
        },
        key="rule-stale",
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "REVISION_CONFLICT"


def test_invalid_thresholds_rejected(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    api.seed_crack()
    latest = api.get("/archive")["rules"][0]
    response = api.post(
        f"/rules/{latest['ruleId']}/versions",
        {
            **rule_body(0.4),
            "expectedRev": latest["rev"],
        },
        key="bad-thresholds",
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_THRESHOLDS"
