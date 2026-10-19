"""S5-01 / S5-02：计划快照、幂等生成、到点与完成。"""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from ..fixtures import FieldApi


def test_generate_is_idempotent_and_plan_changes_do_not_rewrite_snapshot(
    client: TestClient, settings
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    plan = api.create_plan(ids["manual"]["id"], ids["building"]["id"], ids["floor"]["id"])
    first = api.generate(key="snapshot-generate")
    assert len(first["created"]) == 1
    task = api.task_for_point(ids["manual"]["id"])
    frozen = task["planSnapshot"]
    assert frozen["planName"] == "日常巡检"
    assert frozen["pointIds"] == [ids["manual"]["id"]]

    second = api.generate(key="snapshot-generate-second")
    assert second["created"] == []
    assert second["skipped"] == 1
    assert len(api.get("/inspection/tasks")) == 1

    updated = api.ok(
        api.fpatch(
            f"/inspection/plans/{plan['id']}",
            {
                "expectedRev": plan["rev"],
                "name": "改名后的巡检",
                "kind": "patrol",
                "buildingId": ids["building"]["id"],
                "floorIds": [ids["floor"]["id"]],
                "pointIds": [ids["manual"]["id"]],
                "cycle": {"unit": "day", "interval": 1, "atTime": "10:00"},
                "startDate": "2026-01-01",
                "owner": "新负责人",
                "executorRole": "inspector",
                "checklist": [{"key": "wall", "label": "新清单", "required": True, "hint": ""}],
                "enabled": True,
            },
            key="snapshot-plan-edit",
        )
    )
    assert updated["name"] == "改名后的巡检"
    after = api.task_for_point(ids["manual"]["id"])
    assert after["planSnapshot"] == frozen
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    next_day = api.generate(day=tomorrow, key="snapshot-generate-tomorrow")
    assert len(next_day["created"]) == 1
    assert next_day["created"][0]["planSnapshot"]["planName"] == "改名后的巡检"
    assert len(api.get("/inspection/tasks")) == 2


def test_check_in_and_complete_rules(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.create_plan(ids["manual"]["id"], ids["building"]["id"], ids["floor"]["id"])
    api.generate()
    task = api.task_for_point(ids["manual"]["id"])
    point = ids["manual"]
    label = point["nfc"]["code"]

    wrong = api.ok_post(
        f"/inspection/tasks/{task['id']}/check-in",
        {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "method": "nfc",
            "labelRead": "NFC-WRONG",
            "fallbackReason": "",
        },
        "wrong-label",
        "demo-inspector",
    )
    assert wrong["attempt"]["passed"] is False
    assert wrong["task"]["results"][0]["status"] == "pending"
    task = wrong["task"]

    no_reason = api.ok_post(
        f"/inspection/tasks/{task['id']}/check-in",
        {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "method": "manual",
            "labelRead": label,
            "fallbackReason": "",
        },
        "manual-no-reason",
        "demo-inspector",
    )
    assert no_reason["attempt"]["passed"] is False
    task = no_reason["task"]

    arrived = api.ok_post(
        f"/inspection/tasks/{task['id']}/check-in",
        {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "method": "manual",
            "labelRead": label,
            "fallbackReason": "标签损坏，人工核对",
        },
        "manual-ok",
        "demo-inspector",
    )
    assert arrived["attempt"]["passed"] is True
    assert arrived["task"]["results"][0]["status"] == "arrived"
    task = arrived["task"]


def test_complete_requires_arrival_and_role(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.create_plan(ids["manual"]["id"], ids["building"]["id"], ids["floor"]["id"])
    api.generate()
    task = api.task_for_point(ids["manual"]["id"])
    point = ids["manual"]
    label = point["nfc"]["code"]
    arrived = api.ok_post(
        f"/inspection/tasks/{task['id']}/check-in",
        {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "method": "nfc",
            "labelRead": label,
            "fallbackReason": "",
        },
        "complete-check-in",
        "demo-inspector",
    )
    task = arrived["task"]
    incomplete = api.fpost(
        f"/inspection/tasks/{task['id']}/complete-point",
        {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "answers": [],
            "linkedIssueId": None,
            "noIssueReason": "",
        },
        "complete-missing",
        "demo-inspector",
    )
    assert incomplete.status_code == 422
    assert incomplete.json()["error"]["code"] == "CHECK_INCOMPLETE"

    completed = api.ok_post(
        f"/inspection/tasks/{task['id']}/complete-point",
        {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "answers": [{"key": "wall", "label": "墙面", "result": "ok", "note": ""}],
            "linkedIssueId": None,
            "noIssueReason": "",
        },
        "complete-ok",
        "demo-inspector",
    )
    assert completed["task"]["status"] == "checked"
    assert completed["task"]["results"][0]["status"] == "completed"

    unchanged = api.task_for_point(ids["manual"]["id"])
    denied = api.fpost(
        f"/inspection/tasks/{unchanged['id']}/check-in",
        {
            "expectedRev": unchanged["rev"],
            "pointId": point["id"],
            "method": "nfc",
            "labelRead": label,
            "fallbackReason": "",
        },
        "property-denied",
        "demo-property",
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "ROLE_FORBIDDEN"


def test_task_issue_keeps_inspection_source_and_retry(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.create_plan(ids["manual"]["id"], ids["building"]["id"], ids["floor"]["id"])
    api.generate(key="task-source-generate")
    task = api.task_for_point(ids["manual"]["id"])
    body = {
        "expectedRev": task["rev"],
        "pointId": ids["manual"]["id"],
        "anomalyType": "墙面起鼓",
        "description": "巡检发现墙面起鼓",
        "submissionId": "task-source-submission",
        "photos": [],
    }
    path = f"/inspection/tasks/{task['id']}/issues"
    created = api.ok_post(path, body, "task-source-issue", "demo-inspector")
    issue = created["issue"]
    assert issue["source"] == "inspection"
    assert issue["taskId"] == task["id"]
    assert issue["id"] in created["task"]["issueIds"]
    assert issue["id"] in created["task"]["results"][0]["issueIds"]
    replay = api.fpost(path, body, "task-source-replay", "demo-inspector")
    assert replay.status_code == 200
    assert replay.json()["data"]["duplicated"] is True
    assert replay.json()["data"]["issue"]["id"] == issue["id"]
    assert len(api.get("/issues")) == 1
