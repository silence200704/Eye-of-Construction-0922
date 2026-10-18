"""S4-08：通知生成、展示、确认与超时升级分别留痕。"""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from .fixtures import Api, iso


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
