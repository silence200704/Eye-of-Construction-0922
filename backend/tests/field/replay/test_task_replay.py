"""Native retries must reauthorize the target before returning a stored receipt."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from zhutong.db.models import User
from zhutong.db.models.archive import Point

from ..fixtures import FieldApi, counts


def completed_command(api: FieldApi, action: str) -> tuple[str, dict, dict]:
    ids = api.seed_manual_point()
    point = ids["manual"]
    api.create_plan(point["id"], ids["building"]["id"], ids["floor"]["id"])
    api.generate()
    task = api.task_for_point(point["id"])
    arrival = {
        "expectedRev": task["rev"],
        "pointId": point["id"],
        "method": "nfc",
        "labelRead": point["nfc"]["code"],
        "fallbackReason": "",
    }
    if action == "check-in":
        body = arrival
    elif action == "issues":
        body = {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "anomalyType": "墙面异常",
            "description": "巡检回执权限核验场景",
            "submissionId": "native-replay-issue",
            "photos": [],
        }
    else:
        task = api.ok_post(
            f"/inspection/tasks/{task['id']}/check-in", arrival, "replay-arrive", "demo-inspector"
        )["task"]
        body = {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "answers": [{"key": "wall", "result": "ok"}],
            "linkedIssueId": None,
            "noIssueReason": "",
        }
    path = f"/inspection/tasks/{task['id']}/{action}"
    written = api.ok_post(path, body, "native-replay-stable", "demo-inspector")
    return path, body, written


def change_authorization(database_url: str, change: str, point_id: str) -> None:
    engine = create_engine(database_url)
    with Session(engine) as session, session.begin():
        user = session.get(User, "demo-inspector")
        assert user is not None
        if change == "scope":
            user.building_ids_json = "[]"
        elif change == "role":
            user.role = "property"
        else:
            point = session.get(Point, ("demo-main", point_id))
            assert point is not None
            point.status = "archived"
    engine.dispose()


@pytest.mark.parametrize("action", ["check-in", "complete-point", "issues"])
@pytest.mark.parametrize("change", ["scope", "role", "archived"])
def test_task_receipt_replay_rechecks_current_authorization(client, settings, action, change):
    api = FieldApi(client, str(settings.database_url))
    path, body, _ = completed_command(api, action)
    before = counts(str(settings.database_url), "tasks", "audits", "operation_receipts")
    change_authorization(str(settings.database_url), change, body["pointId"])
    replay = api.fpost(path, body, "native-replay-stable", "demo-inspector")
    assert replay.status_code == (404 if change == "archived" else 403)
    assert counts(str(settings.database_url), "tasks", "audits", "operation_receipts") == before


@pytest.mark.parametrize("action", ["check-in", "complete-point", "issues"])
def test_authorized_replay_allows_original_stale_revision_without_duplicate_writes(
    client, settings, action
):
    api = FieldApi(client, str(settings.database_url))
    path, body, written = completed_command(api, action)
    before = counts(str(settings.database_url), "tasks", "audits", "operation_receipts")
    response = api.fpost(path, body, "native-replay-stable", "demo-inspector")
    assert response.status_code == 200
    assert response.json()["replayed"] is True
    assert response.json()["data"] == written
    assert counts(str(settings.database_url), "tasks", "audits", "operation_receipts") == before
