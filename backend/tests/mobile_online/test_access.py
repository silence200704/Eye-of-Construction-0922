from monitoring.fixtures import Api


def test_empty_scope_receives_no_archive_record_alarm_or_notification_facts(client, settings):
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.9)
    token = api.add_scoped_user("mobile-empty", [])
    headers = {"Authorization": f"Bearer {token}"}
    root = "/api/v1/datasets/demo-main"
    archive = client.get(root + "/archive", headers=headers).json()["data"]
    for name in ["buildings", "floors", "points", "devices", "baselines", "audits"]:
        assert archive[name] == [], name
    for path in ["/records", "/events", "/notifications"]:
        assert client.get(root + path, headers=headers).json()["data"] == [], path


def test_old_alarm_receipt_cannot_bypass_a_scope_revocation(client, settings):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from zhutong.db.models import User

    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.9)
    event = api.get("/events")[0]
    token = api.add_scoped_user("mobile-safety", None, role="safety")
    path = f"/api/v1/datasets/demo-main/events/{event['id']}/acknowledge"
    headers = {"Authorization": f"Bearer {token}", "Idempotency-Key": "mobile-ack",
               "X-Dataset-Epoch": "1"}
    body = {"expectedRev": event["rev"]}
    assert client.post(path, json=body, headers=headers).status_code == 200
    engine = create_engine(str(settings.database_url))
    with Session(engine) as db, db.begin():
        db.get(User, "mobile-safety").building_ids_json = "[]"
    engine.dispose()
    assert client.post(path, json=body, headers=headers).status_code == 403

