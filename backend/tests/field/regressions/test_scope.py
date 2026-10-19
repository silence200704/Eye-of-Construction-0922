"""R5-01：现场写入口必须校验目标楼栋范围，不依赖可选照片。"""

from fastapi.testclient import TestClient

from ..fixtures import FieldApi, counts, today


def test_scoped_safety_cannot_touch_out_of_scope_objects(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point = ids["manual"]
    plan = api.create_plan(point["id"], ids["building"]["id"], ids["floor"]["id"])
    api.generate(key="scope-generate")
    api.create_maintenance_plan(ids["device"]["id"], ids["building"]["id"])
    maintenance = api.generate_maintenance(day=today(), key="scope-maintenance")["created"][0]
    issue = api.report_issue(point, submissionId="scope-issue")["issue"]
    manual = api.ok_post(
        "/work-orders", {"pointId": point["id"], "title": "范围校验工单"}, "scope-manual"
    )["order"]
    api.add_scoped_user("scope-empty", [], role="safety")
    scoped = "scope-empty"
    before = counts(str(settings.database_url), "tasks", "audits", "operation_receipts")

    review = api.fpost(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": issue["rev"],
            "action": "recheck",
            "category": "remeasure",
            "note": "范围外审核不应成功",
        },
        "scope-review",
        scoped,
    )
    assert review.status_code == 403
    toggled = api.fpost(
        f"/inspection/plans/{plan['id']}/enabled",
        {"expectedRev": plan["rev"], "enabled": False},
        "scope-plan",
        scoped,
    )
    assert toggled.status_code == 403
    assigned = api.fpost(
        f"/work-orders/{manual['id']}/actions",
        {"expectedRev": manual["rev"], "to": "assigned", "assigneeId": "demo-repair"},
        "scope-assign",
        scoped,
    )
    assert assigned.status_code == 403
    executed = api.fpost(
        f"/maintenance/tasks/{maintenance['id']}/execute",
        {
            "expectedRev": maintenance["rev"],
            "answers": [{"key": "bolt", "result": "ok"}, {"key": "rust", "result": "ok"}],
            "measures": "范围外保养不应成功",
            "nextDueDate": today(),
        },
        "scope-maintenance-execute",
        scoped,
    )
    assert executed.status_code == 403
    assert counts(str(settings.database_url), "tasks", "audits", "operation_receipts") == before
    generated = api.fpost(
        "/inspection/tasks/generate", {"date": today()}, "scope-generate-empty", scoped
    )
    assert generated.status_code == 200
    assert generated.json()["data"]["created"] == []
    assert len(api.get("/inspection/tasks")) == 1
    current = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    assert current["status"] == "pending_review"
    assert api.task_for_point(point["id"])["status"] == "pending"
    assert api.get("/inspection/plans")[0]["enabled"] is True
    stored = next(row for row in api.get("/work-orders") if row["id"] == manual["id"])
    assert stored["status"] == "created"


def test_scoped_safety_can_write_inside_scope(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="scope-allowed")["issue"]
    api.add_scoped_user("scope-inside", [ids["building"]["id"]], role="safety", name="范围内安全员")
    scoped = "scope-inside"
    reviewed = api.fpost(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": issue["rev"],
            "action": "recheck",
            "category": "remeasure",
            "note": "授权范围内可以审核",
        },
        "scope-inside-review",
        scoped,
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["data"]["issue"]["status"] == "pending_recheck"


def test_cross_building_write_is_rejected(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    building = api.ok(
        api.post(
            "/buildings",
            {
                "code": "B04",
                "name": "4号教学楼",
                "purpose": "教学",
                "footprint": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2, "rotate": 0},
            },
            key="scope-b04",
        )
    )
    floor = api.ok(
        api.post(
            "/floors",
            {"buildingId": building["id"], "floorNo": 1, "name": "一层", "zones": ["走廊"]},
            key="scope-b04-floor",
        )
    )
    point = api.ok(
        api.post(
            "/points",
            {
                "code": "B04-F1-CHECK01",
                "name": "4号楼巡检点",
                "buildingId": building["id"],
                "floorId": floor["id"],
                "type": "manual_check",
                "coord": {"x": 0.2, "y": 0.2},
            },
            key="scope-b04-point",
        )
    )
    issue = api.report_issue(point, submissionId="scope-cross-building")["issue"]
    api.add_scoped_user("scope-b03", [ids["building"]["id"]], role="safety")
    denied = api.fpost(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": issue["rev"],
            "action": "recheck",
            "category": "remeasure",
            "note": "跨楼栋审核应被拒绝",
        },
        "scope-cross-review",
        "scope-b03",
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "SCOPE_FORBIDDEN"
