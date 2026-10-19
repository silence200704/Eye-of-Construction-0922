"""当前恢复序列必须与修订后的有效记录一致，关闭不能只信任状态字段。"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from ..fixtures import Api
from .test_records import counts


def recovering_series(api: Api, acknowledged: bool = False) -> list[dict]:
    ids = api.seed_crack()
    rows = [api.add_record(ids["point"]["id"], 0.82, minutes=-30)["record"]]
    if acknowledged:
        event = api.get("/events")[0]
        api.ok(api.post(f"/events/{event['id']}/acknowledge", {"expectedRev": event["rev"]}))
    for value, minute in ((0.54, -20), (0.55, -18), (0.56, -16)):
        rows.append(api.add_record(ids["point"]["id"], value, minutes=minute)["record"])
    assert api.get("/events")[0]["status"] == "recovering"
    return rows


def correction(record: dict, width: float, quality: str = "valid") -> dict:
    return {
        "expectedRev": record["rev"],
        "values": {"width": width},
        "unit": "mm",
        "sampleTime": record["sampleTime"],
        "quality": quality,
        "qualityNote": "现场质量复核",
        "note": "恢复序列复核",
        "reason": "现场复核更正",
    }


def close_request(api: Api, event: dict):
    return api.post(
        f"/events/{event['id']}/close",
        {
            "expectedRev": event["rev"],
            "basis": "连续恢复复测核验",
            "noRepairNote": "现场核查确认无需维修",
        },
    )


@pytest.mark.parametrize("acknowledged", [False, True])
@pytest.mark.parametrize("index", [1, 2, 3])
@pytest.mark.parametrize("change", [("valid", 0.9), ("invalid", 0.55), ("suspect", 0.55)])
def test_revising_any_recovery_sample_invalidates_window(
    client: TestClient, settings, acknowledged: bool, index: int, change: tuple
) -> None:
    quality, width = change
    api = Api(client, str(settings.database_url))
    rows = recovering_series(api, acknowledged)
    record = rows[index]
    api.ok(api.post(f"/records/{record['id']}/revisions", correction(record, width, quality)))
    event = api.get("/events")[0]
    assert event["status"] == ("handling" if acknowledged else "pending")
    assert close_request(api, event).status_code == 409


@pytest.mark.parametrize("acknowledged", [False, True])
@pytest.mark.parametrize("quality", ["valid", "invalid"])
def test_old_evidence_revision_preserves_valid_recovery(
    client: TestClient, settings, acknowledged: bool, quality: str
) -> None:
    api = Api(client, str(settings.database_url))
    rows = recovering_series(api, acknowledged)
    original = rows[0]
    api.ok(api.post(f"/records/{original['id']}/revisions", correction(original, 0.85, quality)))
    event = api.get("/events")[0]
    assert event["status"] == "recovering"
    assert close_request(api, event).status_code == 200


def test_correcting_window_back_to_normal_restores_recovery_and_replays_once(
    client: TestClient, settings
) -> None:
    api = Api(client, str(settings.database_url))
    rows = recovering_series(api)
    middle = rows[2]
    changed = api.ok(
        api.post(f"/records/{middle['id']}/revisions", correction(middle, 0.9), key="window-bad")
    )["record"]
    assert api.get("/events")[0]["status"] == "pending"
    body = correction(changed, 0.55)
    api.ok(api.post(f"/records/{changed['id']}/revisions", body, key="window-fixed"))
    before = counts(str(settings.database_url), "events", "notifications", "audits", "operation_receipts")
    replay = api.post(f"/records/{changed['id']}/revisions", body, key="window-fixed")
    assert replay.json()["replayed"] is True
    assert counts(str(settings.database_url), *before) == before
    assert api.get("/events")[0]["status"] == "recovering"


def test_close_rechecks_actual_records_even_if_recovering_status_is_stale(
    client: TestClient, settings
) -> None:
    api = Api(client, str(settings.database_url))
    rows = recovering_series(api)
    engine = create_engine(str(settings.database_url))
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE records SET quality='invalid' WHERE id=:id"), {"id": rows[3]["id"]}
        )
    engine.dispose()
    before = counts(str(settings.database_url), "events", "audits", "operation_receipts")
    denied = close_request(api, api.get("/events")[0])
    assert denied.status_code == 409
    assert denied.json()["error"]["code"] == "STATE_CONFLICT"
    assert counts(str(settings.database_url), *before) == before


def test_recovery_reconciliation_failure_rolls_back_revision(client: TestClient, settings, monkeypatch) -> None:
    api = Api(client, str(settings.database_url))
    rows = recovering_series(api)
    middle = rows[2]
    before = counts(str(settings.database_url), "records", "events", "audits", "operation_receipts")

    def fail(*_args):
        raise RuntimeError("模拟恢复核验故障")

    monkeypatch.setattr("zhutong.operations.datasets.alarms.recovery.write_audit", fail)
    with pytest.raises(RuntimeError, match="模拟恢复核验故障"):
        api.post(f"/records/{middle['id']}/revisions", correction(middle, 0.9))
    assert counts(str(settings.database_url), *before) == before
    stored = next(row for row in api.get("/records") if row["id"] == middle["id"])
    assert stored["values"] == middle["values"]
    assert stored["rev"] == middle["rev"]
    assert api.get("/events")[0]["status"] == "recovering"
