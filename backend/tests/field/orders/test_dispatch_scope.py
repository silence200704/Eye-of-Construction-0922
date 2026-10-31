"""派工人员须具备目标楼栋范围，否则会产生无法接单的工单。"""

from ..fixtures import FieldApi


def test_dispatch_rejects_worker_without_target_building(client, settings):
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_scoped_user("empty-repair", [], role="repair")
    issue = api.report_issue(ids["manual"], submissionId="dispatch-scope")["issue"]
    order = api.review(issue, "to_repair", "equipment")["order"]
    response = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "assigned", "assigneeId": "empty-repair"},
        "dispatch-empty-worker",
    )
    assert response.status_code == 422
    stored = next(row for row in api.get("/work-orders") if row["id"] == order["id"])
    assert stored["status"] == "created"
    assert stored["assigneeId"] == ""
