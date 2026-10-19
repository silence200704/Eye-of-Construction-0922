"""返修回归：范围越权、事件时序、停用规则、跨目标幂等与关闭事件通知。"""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from .fixtures import Api, iso


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


def _recover(api: Api, point_id: str, start: int = -20) -> None:
    for index, width in enumerate((0.54, 0.55, 0.56)):
        api.add_record(point_id, width, minutes=start + index)


def _close_body(event: dict) -> dict:
    return {
        "expectedRev": event["rev"],
        "basis": "连续三次复测均低于恢复阈值",
        "noRepairNote": "现场核查确认无新增异常，无需维修",
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


def test_recovery_is_overturned_by_new_abnormal_record(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    event = api.get("/events")[0]
    acknowledged = api.ok(
        api.post(f"/events/{event['id']}/acknowledge", {"expectedRev": event["rev"]}, key="reg-ack")
    )
    _recover(api, ids["point"]["id"])
    recovering = api.get("/events")[0]
    assert recovering["status"] == "recovering"

    again = api.add_record(ids["point"]["id"], 0.82, minutes=-10)
    assert "恢复待确认已被新异常推翻" in again["event"]["message"]
    current = api.get("/events")[0]
    assert current["status"] == "handling"
    assert current["acknowledgedAt"] == acknowledged["acknowledgedAt"]
    assert any(item["action"] == "恢复状态被新异常推翻" for item in current["timeline"])
    denied = api.post(
        f"/events/{current['id']}/close",
        _close_body(current),
        key="reg-close-after-recur",
    )
    assert denied.status_code == 409


def test_backfill_cannot_enter_recovery(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-10)
    for minutes in (-60, -50, -40):
        outcome = api.add_record(ids["point"]["id"], 0.54, minutes=minutes)
        assert "历史补录只存档" in outcome["event"]["message"]
    event = api.get("/events")[0]
    assert event["status"] == "pending"
    assert event["level"] == "red"
    assert not any(item["action"] == "进入恢复待确认" for item in event["timeline"])


def test_revision_after_close_does_not_create_event(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    original = api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    _recover(api, ids["point"]["id"])
    event = api.get("/events")[0]
    closed = api.ok(
        api.post(f"/events/{event['id']}/close", _close_body(event), key="reg-close-before-revise")
    )
    assert closed["status"] == "closed"
    stored = next(row for row in api.get("/records") if row["id"] == original["record"]["id"])
    revised = api.ok(
        api.post(
            f"/records/{stored['id']}/revisions",
            {
                "expectedRev": stored["rev"],
                "values": {"width": 0.52},
                "unit": "mm",
                "sampleTime": stored["sampleTime"],
                "note": "关闭后复核原异常记录",
                "reason": "关闭后复核原异常记录",
            },
            key="reg-revise-closed",
        )
    )
    assert "历史修订不新建事件" in revised["event"]["message"]
    events = api.get("/events")
    assert len(events) == 1
    assert events[0]["status"] == "closed"
    assert revised["record"]["revision"] == 1


def test_disabled_latest_rule_version_is_not_bypassed(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    latest = next(
        row for row in api.get("/archive")["rules"] if row["ruleId"] == ids["rule"]["ruleId"]
    )
    payload = {
        "code": latest["code"],
        "name": latest["name"],
        "metric": latest["metric"],
        "unit": latest["unit"],
        "enabled": False,
        "buildingIds": latest["buildingIds"],
        "pointIds": latest["pointIds"],
        "baselineSource": latest["baselineSource"],
        "fixedBaseline": latest["fixedBaseline"],
        "thresholds": latest["thresholds"],
        "rateThreshold": latest["rateThreshold"],
        "rateLevel": latest["rateLevel"],
        "persistence": latest["persistence"],
        "recovery": latest["recovery"],
        "environment": latest["environment"],
        "source": latest["source"],
        "confirmedBy": "学校安全管理人员",
        "note": "返修验证停用版本",
        "effectiveFrom": iso(-1),
        "expectedRev": latest["rev"],
        "expectedVersion": latest["version"],
    }
    version = api.ok(
        api.post(f"/rules/{latest['ruleId']}/versions", payload, key="reg-rule-disabled")
    )
    assert version["version"] == "V1.1"
    outcome = api.add_record(ids["point"]["id"], 0.82, minutes=0)
    assert outcome["record"]["ruleVersion"] == "V1.1"
    assert outcome["assessment"]["state"] == "excluded"
    assert "规则未启用" in outcome["assessment"]["reason"]
    assert outcome["event"]["action"] == "none"
    assert api.get("/events") == []


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


def test_escalation_skips_closed_events(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    _recover(api, ids["point"]["id"])
    event = api.get("/events")[0]
    api.ok(api.post(f"/events/{event['id']}/close", _close_body(event), key="reg-close-escalate"))
    engine = create_engine(str(settings.database_url))
    with engine.begin() as connection:
        connection.execute(
            text("update notifications set created_at = :at where acknowledged_at is null"),
            {"at": iso(-120)},
        )
    engine.dispose()
    result = api.ok(api.post("/notifications/escalate", key="reg-escalate-closed"))
    assert result["escalated"] == 0
    assert all(row["escalatedAt"] is None for row in api.get("/notifications"))


def age_notifications(database_url: str, minutes: int) -> None:
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text("update notifications set created_at = :at where acknowledged_at is null"),
            {"at": iso(-minutes)},
        )
    engine.dispose()


def test_notification_lifecycle(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.62, minutes=-30)
    notes = api.get("/notifications")
    assert len(notes) == 2
    first, second = notes
    assert first["presentedAt"] is None
    assert first["acknowledgedAt"] is None

    presented = api.ok(
        api.post(f"/notifications/{first['id']}/present", key=f"present-{first['id']}")
    )
    assert presented["presentedAt"] is not None
    assert presented["acknowledgedAt"] is None
    replay = api.post(f"/notifications/{first['id']}/present", key=f"present-{first['id']}")
    assert replay.json()["replayed"] is True
    again = api.ok(
        api.post(f"/notifications/{first['id']}/present", key=f"present-again-{first['id']}")
    )
    assert again["presentedAt"] == presented["presentedAt"]
    assert again["rev"] == presented["rev"]

    acknowledged = api.ok(
        api.post(
            f"/notifications/{second['id']}/acknowledge",
            key=f"ack-note-{second['id']}",
        )
    )
    assert acknowledged["acknowledgedAt"] is not None
    assert acknowledged["acknowledgedBy"] == "演示学校安全管理人员"
    assert acknowledged["presentedAt"] is None

    age_notifications(str(settings.database_url), 120)
    escalated = api.ok(api.post("/notifications/escalate", key="escalate-1"))
    assert escalated["escalated"] == 1
    assert escalated["rows"][0]["escalatedTo"] == "替补人员"
    assert escalated["rows"][0]["escalationSource"] == ""
    second_run = api.ok(api.post("/notifications/escalate", key="escalate-2"))
    assert second_run["escalated"] == 0
    stored = {row["id"]: row for row in api.get("/notifications")}
    assert stored[second["id"]]["escalatedAt"] is None
    assert stored[first["id"]]["escalatedAt"] is not None

def test_recovery_overturned_returns_to_pending_when_unacknowledged(
    client: TestClient, settings
) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    _recover(api, ids["point"]["id"])
    assert api.get("/events")[0]["status"] == "recovering"
    again = api.add_record(ids["point"]["id"], 0.82, minutes=-10)
    assert "恢复待确认已被新异常推翻" in again["event"]["message"]
    current = api.get("/events")[0]
    assert current["status"] == "pending"
    assert current["acknowledgedAt"] is None
