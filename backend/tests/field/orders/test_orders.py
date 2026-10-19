"""S5-06 / S5-07 / S5-08：工单、验收、复查与事件关闭依据。"""

from fastapi.testclient import TestClient

from ..fixtures import FieldApi


def _order_flow(api: FieldApi, issue: dict) -> dict:
    reviewed = api.review(issue, "to_repair", "equipment")
    order = reviewed["order"]
    assert order["status"] == "created"
    order = api.advance(order, "assigned", assignee="演示维修人员")
    assert order["order"]["status"] == "assigned"
    order = api.advance(order["order"], "repairing", account="demo-repair")
    assert order["order"]["status"] == "repairing"
    submitted = api.advance(
        order["order"], "submitted", account="demo-repair", measures="更换固定件并复紧"
    )
    assert submitted["order"]["status"] == "submitted"
    assert submitted["order"]["submittedAt"] is not None
    return submitted["order"]


def test_repair_accept_submit_verify_then_recheck_recovered(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="flow-recovered")["issue"]
    order = _order_flow(api, issue)
    verified = api.advance(order, "verified", note="现场复看合格")
    assert verified["order"]["status"] == "verified"
    assert verified["order"]["submittedAt"] == order["submittedAt"]
    current = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    assert current["status"] == "pending_recheck"
    assert current["status"] != "closed"

    recheck = api.register_recheck(current)
    assert recheck["issue"]["rechecks"][-1]["outcome"] is None
    closed = api.recheck_outcome(recheck["issue"], "recovered")
    assert closed["issue"]["status"] == "closed"
    assert closed["issue"]["rechecks"][-1]["outcome"] == "recovered"


def test_return_then_repair_again_and_observing_branch(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="flow-return")["issue"]
    order = _order_flow(api, issue)
    returned = api.advance(order, "returned", note="材料清单与现场不符，退回补充")
    assert returned["order"]["status"] == "returned"
    assert returned["order"]["reviews"][-1]["result"] == "fail"
    again = api.advance(returned["order"], "repairing", account="demo-repair")
    assert again["order"]["status"] == "repairing"
    submitted = api.advance(
        again["order"], "submitted", account="demo-repair", measures="补齐材料后重新安装"
    )
    verified = api.advance(submitted["order"], "verified", note="补充材料齐全")
    assert verified["order"]["status"] == "verified"

    current = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    registered = api.register_recheck(current)
    observing = api.recheck_outcome(registered["issue"], "observing", nextDueDate="2026-11-01")
    assert observing["issue"]["status"] == "observing"
    assert len(observing["issue"]["rechecks"]) == 2
    assert observing["issue"]["rechecks"][-1]["outcome"] is None


def test_work_order_permissions_and_acceptance_roles(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="flow-roles")["issue"]
    reviewed = api.review(issue, "to_repair", "general")
    order = reviewed["order"]

    repair_assign = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "assigned", "assignee": "演示维修人员"},
        "repair-assign",
        "demo-repair",
    )
    assert repair_assign.status_code == 409

    no_assignee = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "assigned"},
        "assignee-required",
    )
    assert no_assignee.status_code == 409

    assigned = api.advance(order, "assigned", assignee="演示维修人员")
    no_reason = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": assigned["order"]["rev"], "to": "repairing"},
        "property-no-reason",
        "demo-property",
    )
    assert no_reason.status_code == 409
    property_accept = api.advance(
        assigned["order"],
        "repairing",
        account="demo-property",
        note="原维修人员不在，物业值班代接并说明原因",
    )
    assert property_accept["order"]["status"] == "repairing"
    submitted = api.advance(
        property_accept["order"],
        "submitted",
        account="demo-property",
        measures="临时加固并记录",
    )
    verify_denied = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": submitted["order"]["rev"], "to": "verified"},
        "repair-verify-denied",
        "demo-repair",
    )
    assert verify_denied.status_code == 409
    verified = api.advance(submitted["order"], "verified")
    assert verified["order"]["status"] == "verified"


def test_event_close_accepts_current_event_verified_work_order(
    client: TestClient, settings
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-40)
    event = api.get("/events")[0]
    issue = api.ok_post(
        "/issues",
        {
            "source": "sensor",
            "pointId": ids["point"]["id"],
            "buildingId": ids["building"]["id"],
            "floorId": ids["floor"]["id"],
            "anomalyType": "裂缝越限",
            "description": "预警转问题后维修",
            "submissionId": "event-order",
            "eventId": event["id"],
        },
        "event-order-issue",
    )["issue"]
    order = _order_flow(api, issue)
    api.advance(order, "verified", note="关联事件工单验收通过")
    for index, width in enumerate((0.54, 0.55, 0.56)):
        api.add_record(ids["point"]["id"], width, minutes=-20 + index)
    current = api.get("/events")[0]
    assert current["status"] == "recovering"
    closed = api.ok_post(
        f"/events/{current['id']}/close",
        {
            "expectedRev": current["rev"],
            "basis": "连续恢复复测完成，关联工单已验收",
            "noRepairNote": "",
        },
        "event-close-order",
    )
    assert closed["status"] == "closed"
    assert "已验收通过" in closed["timeline"][-1]["detail"]

    missing = api.fpost(
        f"/events/{current['id']}/close",
        {"expectedRev": closed["rev"], "basis": "再次关闭", "noRepairNote": ""},
        "event-close-again",
    )
    assert missing.status_code == 409


def test_event_close_rejects_work_order_from_previous_event(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    point = ids["point"]
    api.add_record(point["id"], 0.82, minutes=-50)
    first_event = api.get("/events")[0]
    issue = api.ok_post(
        "/issues",
        {
            "source": "sensor",
            "pointId": point["id"],
            "buildingId": ids["building"]["id"],
            "floorId": ids["floor"]["id"],
            "anomalyType": "裂缝越限",
            "description": "第一个事件的处置",
            "submissionId": "previous-event-order",
            "eventId": first_event["id"],
        },
        "previous-event-issue",
    )["issue"]
    order = _order_flow(api, issue)
    verified = api.advance(order, "verified", note="第一个事件的工单验收")
    assert verified["order"]["status"] == "verified"
    for index, width in enumerate((0.54, 0.55, 0.56)):
        api.add_record(point["id"], width, minutes=-30 + index)
    first_event = api.get("/events")[0]
    closed = api.ok_post(
        f"/events/{first_event['id']}/close",
        {
            "expectedRev": first_event["rev"],
            "basis": "第一个事件恢复并处置完成",
            "noRepairNote": "",
        },
        "previous-event-close",
    )
    assert closed["status"] == "closed"

    api.add_record(point["id"], 0.82, minutes=1)
    second_event = next(row for row in api.get("/events") if row["id"] != first_event["id"])
    assert second_event["id"] != first_event["id"]
    for index, width in enumerate((0.54, 0.55, 0.56)):
        api.add_record(point["id"], width, minutes=2 + index)
    second_event = next(row for row in api.get("/events") if row["id"] == second_event["id"])
    assert second_event["status"] == "recovering"
    denied = api.fpost(
        f"/events/{second_event['id']}/close",
        {
            "expectedRev": second_event["rev"],
            "basis": "借用上一个事件的验收工单",
            "noRepairNote": "",
        },
        "previous-event-reuse",
    )
    assert denied.status_code == 422
    assert denied.json()["error"]["code"] == "CLOSE_BASIS_REQUIRED"
    stored = next(row for row in api.get("/work-orders") if row["id"] == order["id"])
    assert stored["eventId"] == first_event["id"]
