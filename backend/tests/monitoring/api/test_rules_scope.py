"""返修回归：规则版本、范围变更与独立规则。"""

from fastapi.testclient import TestClient

from ..fixtures import Api, iso


def _exclude_original_rule(api: Api, ids: dict) -> dict:
    latest = next(
        row for row in api.get("/archive")["rules"] if row["ruleId"] == ids["rule"]["ruleId"]
    )
    base = {
        "code": latest["code"],
        "name": latest["name"],
        "metric": latest["metric"],
        "unit": latest["unit"],
        "enabled": True,
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
        "effectiveFrom": iso(-10),
        "expectedRev": latest["rev"],
        "expectedVersion": latest["version"],
    }
    v11 = api.ok(
        api.post(
            f"/rules/{latest['ruleId']}/versions",
            {**base, "buildingIds": ["bld_other"]},
            key="reg-rule-v11-building",
        )
    )
    return api.ok(
        api.post(
            f"/rules/{latest['ruleId']}/versions",
            {
                **base,
                "buildingIds": [],
                "pointIds": ["pnt_other"],
                "effectiveFrom": iso(-5),
                "expectedRev": v11["rev"],
                "expectedVersion": v11["version"],
            },
            key="reg-rule-v12-point",
        )
    )


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


def test_rule_scope_change_does_not_fall_back_to_old_version(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    v12 = _exclude_original_rule(api, ids)
    preview = api.ok(
        api.post(
            "/assessments/preview",
            {
                "pointId": ids["point"]["id"],
                "values": {"width": 0.62},
                "unit": "mm",
                "sampleTime": iso(0),
            },
        )
    )
    assert preview["rule"] is None
    created = api.add_record(ids["point"]["id"], 0.62, minutes=0)
    assert created["record"]["ruleVersion"] is None
    assert created["assessment"] is None
    assert created["event"]["action"] == "none"
    assert api.get("/events") == []
    historical = api.ok(
        api.post(
            "/assessments/preview",
            {
                "pointId": ids["point"]["id"],
                "values": {"width": 0.62},
                "unit": "mm",
                "sampleTime": iso(-60),
            },
        )
    )
    assert historical["rule"]["version"] == "V1.0"
    assert v12["version"] == "V1.2"


def test_independent_rule_still_selected(client: TestClient, settings) -> None:
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    _exclude_original_rule(api, ids)
    other = api.ok(
        api.post(
            "/rules",
            {
                "code": "RULE-RC-OTHER",
                "name": "独立复核规则",
                "metric": "crack_width",
                "unit": "mm",
                "pointIds": [ids["point"]["id"]],
                "thresholds": {"yellow": 0.1, "orange": 0.2, "red": 0.3},
                "persistence": {
                    "minRecords": 3,
                    "minSpanMinutes": 10,
                    "maxGapMinutes": 5,
                    "level": "orange",
                },
                "recovery": {"yellowRatio": 0.8, "minRecords": 3, "minSpanMinutes": 0},
                "effectiveFrom": iso(-2),
                "source": "返修复验",
            },
            key="reg-rule-other",
        )
    )
    independent = api.ok(
        api.post(
            "/assessments/preview",
            {
                "pointId": ids["point"]["id"],
                "values": {"width": 0.62},
                "unit": "mm",
                "sampleTime": iso(1),
            },
        )
    )
    assert independent["rule"]["code"] == "RULE-RC-OTHER"
    created = api.add_record(ids["point"]["id"], 0.62, minutes=1)
    assert created["record"]["ruleSnapshot"]["ruleCode"] == "RULE-RC-OTHER"
    assert created["assessment"]["state"] == "yellow"
    assert other["version"] == "V1.0"
