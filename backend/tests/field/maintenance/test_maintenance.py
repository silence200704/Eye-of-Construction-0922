"""S5-05 / S5-09 / S5-10：保养周期任务、执行、下次日期与异常转问题双向关联。"""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from ..fixtures import FieldApi, counts


def maintenance_body(plan: dict, **overrides) -> dict:
    return {
        "expectedRev": plan["rev"],
        "name": plan["name"],
        "deviceId": plan["deviceId"],
        "buildingId": plan["buildingId"],
        "cycle": plan["cycle"],
        "startDate": plan["startDate"],
        "endDate": plan["endDate"],
        "owner": plan["owner"],
        "checklist": plan["checklist"],
        "enabled": plan["enabled"],
        "remark": plan["remark"],
        **overrides,
    }


def test_maintenance_generate_is_idempotent_and_snapshot_frozen(
    client: TestClient, settings
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    plan = api.create_maintenance_plan(ids["device"]["id"], ids["building"]["id"])
    first = api.generate_maintenance(day=date.today().isoformat(), key="mgen-first")
    assert len(first["created"]) == 1
    second = api.generate_maintenance(day=date.today().isoformat(), key="mgen-second")
    assert second["created"] == []
    assert second["skipped"] == 1
    tasks = api.get("/maintenance/tasks")
    assert len(tasks) == 1
    frozen = tasks[0]["snapshot"]

    updated = api.ok(
        api.fpatch(
            f"/maintenance/plans/{plan['id']}",
            maintenance_body(
                plan,
                name="改后保养计划",
                checklist=[{"key": "paint", "label": "防腐涂层", "required": True}],
            ),
            key="mplan-edit",
        )
    )
    assert updated["name"] == "改后保养计划"
    same = api.get("/maintenance/tasks")[0]
    assert same["snapshot"] == frozen
    assert same["snapshot"]["planName"] == plan["name"]
    assert same["snapshot"]["checklist"] == plan["checklist"]

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    created = api.generate_maintenance(day=tomorrow, key="mgen-tomorrow")
    assert len(created["created"]) == 1
    assert created["created"][0]["snapshot"]["planName"] == "改后保养计划"
    assert len(api.get("/maintenance/tasks")) == 2


def test_maintenance_execute_abnormal_issue_is_bidirectional_and_retry_safe(
    client: TestClient, settings
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    point = ids["point"]
    api.create_maintenance_plan(ids["device"]["id"], ids["building"]["id"])
    task = api.generate_maintenance(day=date.today().isoformat(), key="mgen-abnormal")["created"][0]
    photo = api.upload_photo(point["id"], key="m-photo")
    body = {
        "answers": [
            {"key": "bolt", "result": "normal", "note": ""},
            {"key": "rust", "result": "abnormal", "note": "锚固端锈蚀"},
        ],
        "measures": "清理锈蚀并补涂防锈漆",
        "materials": "防锈漆",
        "nextDueDate": "2026-11-01",
        "note": "本次保养完成",
        "abnormalNote": "发现锚固端锈蚀",
        "createIssue": True,
        "photos": [{"mediaId": photo["id"], "draftId": "m-draft", "kind": "scene"}],
    }
    result = api.execute_maintenance(task, body, "maintenance-execute")
    assert result["task"]["status"] == "done"
    assert result["task"]["execution"]["nextDueDate"] == "2026-11-01"
    assert result["task"]["execution"]["photos"]
    issue = result["issue"]
    assert issue["source"] == "maintenance"
    assert issue["maintenanceTaskId"] == task["id"]
    assert issue["status"] == "pending_review"
    assert result["task"]["execution"]["issueId"] == issue["id"]
    listing = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    assert listing["maintenanceTaskId"] == task["id"]
    attachment = next(
        row for row in api.get("/attachments") if row["maintenanceTaskId"] == task["id"]
    )
    assert attachment["mediaId"] == photo["id"]
    assert attachment["sha256"] == photo["sha256"]

    before = counts(
        str(settings.database_url),
        "issues",
        "maintenance_tasks",
        "attachments",
        "audits",
        "operation_receipts",
    )
    replay = api.fpost(
        f"/maintenance/tasks/{task['id']}/execute",
        {"expectedRev": task["rev"], **body},
        "maintenance-execute",
    )
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert counts(str(settings.database_url), *before) == before

    current = api.get("/maintenance/tasks")[0]
    again = api.fpost(
        f"/maintenance/tasks/{task['id']}/execute",
        {"expectedRev": current["rev"], **body},
        "maintenance-again",
    )
    assert again.status_code == 422
    assert again.json()["error"]["code"] == "MAINTENANCE_INVALID"


def test_maintenance_requires_complete_checklist_measures_and_abnormal_note(
    client: TestClient, settings
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    api.create_maintenance_plan(ids["device"]["id"], ids["building"]["id"])
    task = api.generate_maintenance(day=date.today().isoformat(), key="mgen-guard")["created"][0]
    path = f"/maintenance/tasks/{task['id']}/execute"
    cases = [
        ({"answers": [], "measures": "检查", "nextDueDate": "2026-11-01"}, "MAINTENANCE_INVALID"),
        (
            {
                "answers": [
                    {"key": "bolt", "result": "normal"},
                    {"key": "rust", "result": "normal"},
                ],
                "measures": "",
                "nextDueDate": "2026-11-01",
            },
            "MAINTENANCE_INVALID",
        ),
        (
            {
                "answers": [
                    {"key": "bolt", "result": "normal"},
                    {"key": "rust", "result": "normal"},
                ],
                "measures": "紧固",
                "nextDueDate": "2026-02-30",
            },
            "MAINTENANCE_INVALID",
        ),
        (
            {
                "answers": [
                    {"key": "bolt", "result": "normal"},
                    {"key": "rust", "result": "abnormal"},
                ],
                "measures": "补漆",
                "nextDueDate": "2026-11-01",
            },
            "VALIDATION_FAILED",
        ),
        (
            {
                "answers": [
                    {"key": "bolt", "result": "normal"},
                    {"key": "rust", "result": "normal"},
                ],
                "measures": "检查",
                "nextDueDate": "2026-11-01",
                "createIssue": True,
            },
            "VALIDATION_FAILED",
        ),
    ]
    for index, (body, code) in enumerate(cases):
        response = api.fpost(
            path, {"expectedRev": task["rev"], **body}, f"maintenance-guard-{index}"
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == code
    assert api.get("/maintenance/tasks")[0]["status"] == "pending"
