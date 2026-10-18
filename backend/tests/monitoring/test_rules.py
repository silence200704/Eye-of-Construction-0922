"""S4-02：规则修改生成新版本，历史记录仍引用原版本。"""

from fastapi.testclient import TestClient

from .fixtures import Api, iso


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
