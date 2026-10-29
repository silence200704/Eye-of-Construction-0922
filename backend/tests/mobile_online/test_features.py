from monitoring.fixtures import Api


def test_simulated_device_status_is_persistent_nullable_and_scoped(client, settings):
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    path = f"/devices/{ids['device']['id']}/simulation"
    body = {
        "expectedRev": ids["device"]["rev"],
        "connection": "offline",
        "batteryPercent": 12,
        "lastReportAt": "2026-10-29T02:00:00Z",
    }
    first = api.ok(api.post(path, body, key="device-status"))
    assert first["telemetry"]["source"] == "simulation"
    assert first["telemetry"]["batteryPercent"] == 12
    assert api.get("/archive")["devices"][0] == first
    assert api.ok(api.post(path, body, key="device-status")) == first
    assert api.post(path, {**body, "batteryPercent": 101}, key="invalid-status").status_code == 422
    empty = api.ok(
        api.post(
            path,
            {
                "expectedRev": first["rev"],
                "connection": "unknown",
                "batteryPercent": None,
                "lastReportAt": None,
            },
        )
    )
    assert empty["telemetry"]["batteryPercent"] is None


def test_field_notes_append_without_changing_alarm_status_and_retry_is_idempotent(client, settings):
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.9)
    event = api.get("/events")[0]
    path = f"/events/{event['id']}/field-notes"
    body = {
        "expectedRev": event["rev"],
        "kind": "investigation",
        "note": "模拟现场排查：已核对楼栋及测点情况，等待后续处置",
    }
    result = api.ok(api.post(path, body, key="field-note"))
    assert result["status"] == event["status"] and result["rev"] == event["rev"] + 1
    assert result["timeline"][-1]["detail"] == body["note"]
    assert api.ok(api.post(path, body, key="field-note")) == result


def test_mobile_insights_aggregate_all_authorized_rows_and_fill_empty_days(client, settings):
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.9)
    result = api.get("/mobile/insights", period="week")
    assert result["totalEvents"] == 1 and result["recordCount"] == 1
    assert len(result["trend"]) == 7 and sum(row["count"] for row in result["trend"]) == 1
    assert result["byBuilding"][0]["count"] == 1 and result["sensorTypes"][0]["count"] == 1
    token = api.add_scoped_user("mobile-stats-empty", [])
    empty = client.get(
        "/api/v1/datasets/demo-main/mobile/insights?period=month",
        headers={"Authorization": f"Bearer {token}"},
    ).json()["data"]
    assert empty["totalEvents"] == empty["recordCount"] == 0
    assert len(empty["trend"]) == 30 and empty["sensorTypes"] == []
