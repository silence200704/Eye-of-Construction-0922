"""R5-04：审核状态转移与复查轮次绑定，不允许旧轮次绕过新维修。"""

from fastapi.testclient import TestClient

from ..fixtures import FieldApi, today


def _verified_order(api: FieldApi, issue: dict) -> dict:
    order = api.review(issue, "to_repair", "equipment")["order"]
    order = api.advance(order, "assigned", assigneeId="demo-repair")["order"]
    order = api.advance(order, "repairing", account="demo-repair")["order"]
    order = api.advance(order, "submitted", account="demo-repair", measures="完成维修")["order"]
    return api.advance(order, "verified", note="验收通过")["order"]


def test_duplicate_to_repair_is_rejected(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="duplicate-repair")["issue"]
    first = api.review(issue, "to_repair", "equipment")
    second = api.fpost(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": first["issue"]["rev"],
            "action": "to_repair",
            "category": "equipment",
            "note": "重复点击转维修不应新建工单",
        },
        "duplicate-repair-second",
    )
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "STATE_CONFLICT"
    stored = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    assert stored["workOrderIds"] == [first["order"]["id"]]


def test_old_recheck_cannot_close_after_new_repair(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="old-round")["issue"]
    issue = api.review(issue, "recheck", "remeasure")["issue"]
    issue = api.register_recheck(issue, dueDate=today())["issue"]
    issue = api.review(issue, "to_repair", "equipment")["issue"]
    order = api.advance(
        next(row for row in api.get("/work-orders") if row["issueId"] == issue["id"]),
        "assigned",
        assigneeId="demo-repair",
    )["order"]
    order = api.advance(order, "repairing", account="demo-repair")["order"]
    order = api.advance(order, "submitted", account="demo-repair", measures="新一轮维修")["order"]
    api.advance(order, "verified", note="新一轮验收")
    current = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    assert current["status"] == "pending_recheck"
    outcome = api.fpost(
        f"/issues/{issue['id']}/rechecks/outcome",
        {
            "expectedRev": current["rev"],
            "outcome": "recovered",
            "note": "试图复用旧轮次关闭问题",
        },
        "old-round-outcome",
    )
    assert outcome.status_code == 422
    assert outcome.json()["error"]["code"] == "RECHECK_INVALID"
    stored = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    assert stored["status"] == "pending_recheck"
    assert all(not row.get("outcome") for row in stored["rechecks"])


def test_repairing_issue_cannot_be_reviewed_again(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="repairing-review")["issue"]
    reviewed = api.review(issue, "to_repair", "equipment")
    denied = api.fpost(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": reviewed["issue"]["rev"],
            "action": "close_no_fault",
            "category": "no_fault",
            "note": "维修中不能绕过工单直接关闭问题",
        },
        "repairing-review-close",
    )
    assert denied.status_code == 422
    assert denied.json()["error"]["code"] == "REVIEW_INVALID"
