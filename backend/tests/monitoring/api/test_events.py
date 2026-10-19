"""返修回归：事件时序、恢复、修订与通知。"""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from ..fixtures import Api, iso


def _recover(api: Api, point_id: str, start: int = -20) -> None:
    for index, width in enumerate((0.54, 0.55, 0.56)):
        api.add_record(point_id, width, minutes=start + index)


def _close_body(event: dict) -> dict:
    return {
        "expectedRev": event["rev"],
        "basis": "连续三次复测均低于恢复阈值",
        "noRepairNote": "现场核查确认无新增异常，无需维修",
    }


def _revise(api: Api, record: dict, width: float, key: str) -> dict:
    return api.ok(
        api.post(
            f"/records/{record['id']}/revisions",
            {
                "expectedRev": record["rev"],
                "values": {"width": width},
                "unit": "mm",
                "sampleTime": record["sampleTime"],
                "quality": "valid",
                "note": "复核更正",
                "reason": "复核更正",
            },
            key=key,
        )
    )


def _latest_record(api: Api, point_id: str) -> dict:
    return [row for row in api.get("/records") if row["pointId"] == point_id][-1]


def age_notifications(database_url: str, minutes: int) -> None:
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text("update notifications set created_at = :at where acknowledged_at is null"),
            {"at": iso(-minutes)},
        )
    engine.dispose()


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
    assert "历史修订只更新记录" in revised["event"]["message"]
    events = api.get("/events")
    assert len(events) == 1
    assert events[0]["status"] == "closed"
    assert revised["record"]["revision"] == 1


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


def test_revision_latest_normal_to_red_creates_event(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    created = api.add_record(ids["point"]["id"], 0.55, minutes=-30)
    assert created["event"]["action"] == "none"
    revised = _revise(api, created["record"], 0.82, "reg-latest-normal-red")
    assert revised["assessment"]["state"] == "red"
    assert revised["event"]["action"] == "created"
    events = api.get("/events")
    assert len(events) == 1
    assert events[0]["status"] == "pending"
    assert len(events[0]["evidences"]) == 1
    assert revised["record"]["revision"] == 1
    assert revised["record"]["revisions"][0]["before"]["values"] == {"width": 0.55}


def test_revision_latest_recovery_to_red_invalidates_recovery_pending(
    client: TestClient, settings
) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    _recover(api, ids["point"]["id"])
    assert api.get("/events")[0]["status"] == "recovering"
    latest = _latest_record(api, ids["point"]["id"])
    revised = _revise(api, latest, 0.82, "reg-recovery-revise-pending")
    assert "恢复待确认已被新异常推翻" in revised["event"]["message"]
    event = api.get("/events")[0]
    assert event["status"] == "pending"
    denied = api.post(
        f"/events/{event['id']}/close",
        _close_body(event),
        key="reg-close-after-recovery-revise-pending",
    )
    assert denied.status_code == 409


def test_revision_latest_recovery_to_red_invalidates_recovery_handling(
    client: TestClient, settings
) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    event = api.get("/events")[0]
    api.ok(
        api.post(
            f"/events/{event['id']}/acknowledge",
            {"expectedRev": event["rev"]},
            key="reg-rev-ack",
        )
    )
    _recover(api, ids["point"]["id"])
    latest = _latest_record(api, ids["point"]["id"])
    revised = _revise(api, latest, 0.82, "reg-recovery-revise-handling")
    assert "恢复待确认已被新异常推翻" in revised["event"]["message"]
    event = api.get("/events")[0]
    assert event["status"] == "handling"
    denied = api.post(
        f"/events/{event['id']}/close",
        _close_body(event),
        key="reg-close-after-recovery-revise-handling",
    )
    assert denied.status_code == 409


def test_revision_retry_does_not_duplicate_event(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    created = api.add_record(ids["point"]["id"], 0.55, minutes=-30)
    body = {
        "expectedRev": created["record"]["rev"],
        "values": {"width": 0.82},
        "unit": "mm",
        "sampleTime": created["record"]["sampleTime"],
        "quality": "valid",
        "note": "复核更正",
        "reason": "复核更正",
    }
    first = api.ok(
        api.post(f"/records/{created['record']['id']}/revisions", body, key="reg-revise-once")
    )
    before = {
        "events": len(api.get("/events")),
        "notifications": len(api.get("/notifications")),
        "audits": len(api.get("/audits")),
    }
    replay = api.post(f"/records/{created['record']['id']}/revisions", body, key="reg-revise-once")
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    after = {
        "events": len(api.get("/events")),
        "notifications": len(api.get("/notifications")),
        "audits": len(api.get("/audits")),
    }
    assert before == after
    assert first["record"]["revision"] == 1
