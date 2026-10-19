"""S4-02 / S4-04 / S4-06 / S4-07：记录快照、修订、补录与事件。"""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from zhutong.operations.datasets.alarms import apply as alarm_apply

from .fixtures import Api, iso


def counts(database_url: str, *tables: str) -> dict[str, int]:
    engine = create_engine(database_url)
    with engine.connect() as connection:
        result = {
            table: connection.execute(text(f'select count(*) from "{table}"')).scalar_one()
            for table in tables
        }
    engine.dispose()
    return result


def test_record_keeps_rule_and_baseline_versions(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    first = api.add_record(ids["point"]["id"], 0.55, minutes=-60)
    record = first["record"]
    assert record["baselineVersion"] == 1
    assert record["ruleVersion"] == "V1.0"
    assert record["ruleSnapshot"]["thresholds"] == {"yellow": 0.1, "orange": 0.2, "red": 0.3}
    assert record["assessment"]["state"] == "normal"

    second_baseline = api.ok(
        api.post(
            "/baselines",
            {
                "pointId": ids["point"]["id"],
                "values": {"width": 0.6},
                "unit": "mm",
                "reason": "复测调整",
                "effectiveFrom": iso(-30),
                "expectedVersion": 1,
            },
            key="baseline-v2",
        )
    )
    assert second_baseline["version"] == 2
    second = api.add_record(ids["point"]["id"], 0.82, minutes=-10)
    assert second["record"]["baselineVersion"] == 2
    assert second["record"]["baselineValues"] == {"width": 0.6}
    stored = {row["id"]: row for row in api.get("/records")}
    assert stored[record["id"]]["baselineVersion"] == 1
    assert stored[record["id"]]["baselineValues"] == {"width": 0.5}


def test_revision_keeps_before_value_and_withdraws_evidence(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    created = api.add_record(ids["point"]["id"], 0.82, minutes=-10)
    record = created["record"]
    assert created["event"]["action"] == "created"
    revised = api.ok(
        api.post(
            f"/records/{record['id']}/revisions",
            {
                "expectedRev": record["rev"],
                "values": {"width": 0.52},
                "unit": "mm",
                "sampleTime": record["sampleTime"],
                "quality": "valid",
                "note": "复核后修正读数",
                "reason": "原始读数录错",
            },
            key=f"revise-{record['id']}-1",
        )
    )
    assert revised["record"]["revision"] == 1
    assert revised["record"]["revisions"][0]["before"]["values"] == {"width": 0.82}
    assert revised["record"]["revisions"][0]["reason"] == "原始读数录错"
    assert revised["event"]["action"] == "appended"
    events = api.get("/events")
    assert len(events) == 1
    assert events[0]["status"] == "pending"
    assert events[0]["evidences"] == []
    assert len(events[0]["supersededEvidences"]) == 1
    assert "撤销" in revised["event"]["message"]


def test_backfill_does_not_regress_current_event(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    current = api.add_record(ids["point"]["id"], 0.82, minutes=-45)
    assert current["record"]["isBackfill"] is True
    event = api.get("/events")[0]
    assert event["lastTriggerAt"] == current["record"]["sampleTime"]
    older = api.add_record(ids["point"]["id"], 0.62, minutes=-180)
    assert older["assessment"]["state"] == "yellow"
    assert "历史补录只存档" in older["event"]["message"]
    events = api.get("/events")
    assert len(events) == 1
    assert events[0]["status"] == "pending"
    assert events[0]["level"] == "red"
    assert events[0]["lastTriggerAt"] == current["record"]["sampleTime"]
    assert len(events[0]["evidences"]) == 1
    assert any(row["id"] == older["record"]["id"] for row in api.get("/records"))


def test_duplicate_minute_rejected(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.55, minutes=-60)
    duplicate = api.post(
        "/records",
        {
            "pointId": ids["point"]["id"],
            "values": {"width": 0.56},
            "unit": "mm",
            "sampleTime": iso(-60),
            "note": "重复录入",
        },
    )
    assert duplicate.status_code == 422
    fields = duplicate.json()["error"]["details"]["fields"]
    assert any(
        issue["field"] == "sampleTime" and "已有记录" in issue["message"] for issue in fields
    )


def test_retry_same_record_key_writes_once(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    body = {
        "pointId": ids["point"]["id"],
        "values": {"width": 0.55},
        "unit": "mm",
        "sampleTime": iso(-60),
        "note": "现场录入",
    }
    first = api.post("/records", body, key="record-once")
    second = api.post("/records", body, key="record-once")
    assert second.json()["replayed"] is True
    assert second.json()["data"]["record"]["id"] == first.json()["data"]["record"]["id"]
    assert counts(str(settings.database_url), "records")["records"] == 1


def test_revision_retry_writes_once(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    record = api.add_record(ids["point"]["id"], 0.55)["record"]
    body = {
        "expectedRev": record["rev"],
        "values": {"width": 0.56},
        "unit": "mm",
        "sampleTime": record["sampleTime"],
        "note": "复核修正",
        "reason": "复核修正",
    }
    api.post(f"/records/{record['id']}/revisions", body, key="revision-once")
    replay = api.post(f"/records/{record['id']}/revisions", body, key="revision-once")
    assert replay.json()["replayed"] is True
    stored = api.get("/records")[0]
    assert stored["revision"] == 1
    assert len(stored["revisions"]) == 1


def test_yellow_orange_red_single_event(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.62, minutes=-30)
    api.add_record(ids["point"]["id"], 0.73, minutes=-20)
    api.add_record(ids["point"]["id"], 0.82, minutes=-10)
    events = api.get("/events")
    assert len(events) == 1
    assert events[0]["level"] == "red"
    assert events[0]["peakLevel"] == "red"
    assert len(events[0]["upgrades"]) == 2
    assert len(events[0]["evidences"]) == 3
    notes = api.get("/notifications")
    assert len(notes) == 7
    assert {note["level"] for note in notes} == {"yellow", "orange", "red"}


def test_recovery_and_authorized_close(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    event = api.get("/events")[0]
    acknowledged = api.ok(
        api.post(
            f"/events/{event['id']}/acknowledge",
            {"expectedRev": event["rev"]},
            key="ack-event",
        )
    )
    assert acknowledged["status"] == "handling"
    for index, width in enumerate((0.54, 0.55, 0.56)):
        api.add_record(ids["point"]["id"], width, minutes=-20 + index)
    recovered = api.get("/events")[0]
    assert recovered["status"] == "recovering"
    wrong_role = Api(client, str(settings.database_url), account="demo-property")
    denied = wrong_role.post(
        f"/events/{recovered['id']}/close",
        {"expectedRev": recovered["rev"], "basis": "数据恢复", "noRepairNote": "现场核查无需维修"},
    )
    assert denied.status_code == 403
    no_basis = api.post(
        f"/events/{recovered['id']}/close",
        {"expectedRev": recovered["rev"], "basis": "数据恢复"},
        key="close-no-basis",
    )
    assert no_basis.status_code == 422
    closed = api.ok(
        api.post(
            f"/events/{recovered['id']}/close",
            {
                "expectedRev": recovered["rev"],
                "basis": "连续三条低于恢复阈值",
                "noRepairNote": "现场核查确认无需维修",
            },
            key="close-event",
        )
    )
    assert closed["status"] == "closed"
    assert closed["closedBy"] == "演示学校安全管理人员"
    assert closed["closeBasis"] == "连续三条低于恢复阈值"
    assert api.get("/events")[0]["status"] == "closed"


def test_mid_transaction_failure_rolls_back_everything(settings, monkeypatch) -> None:
    from zhutong.app import create_app
    from zhutong.bootstrap import initialize

    initialize(settings)
    with TestClient(create_app(settings), raise_server_exceptions=False) as client:
        api = Api(client, str(settings.database_url))
        ids = api.seed_crack()
        before = counts(
            str(settings.database_url),
            "records",
            "events",
            "notifications",
            "audits",
            "operation_receipts",
        )

        def explode(*args, **kwargs):
            raise RuntimeError("模拟通知写入失败")

        monkeypatch.setattr(alarm_apply, "_add_notifications", explode)
        response = api.post(
            "/records",
            {
                "pointId": ids["point"]["id"],
                "values": {"width": 0.82},
                "unit": "mm",
                "sampleTime": iso(-10),
                "note": "触发事件",
            },
            key="rollback-record",
        )
        assert response.status_code == 500
    result = counts(
        str(settings.database_url),
        "records",
        "events",
        "notifications",
        "audits",
        "operation_receipts",
    )
    assert result == before
    assert result["records"] == 0
    assert result["events"] == 0
    assert result["notifications"] == 0
