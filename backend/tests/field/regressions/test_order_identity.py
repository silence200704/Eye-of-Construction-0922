"""R5-02：工单派工与接单按稳定身份 ID，不接受请求篡改维修人。"""

from fastapi.testclient import TestClient

from ..fixtures import FieldApi


def _created_order(api: FieldApi, ids: dict, submission: str) -> dict:
    issue = api.report_issue(ids["manual"], submissionId=submission)["issue"]
    return api.review(issue, "to_repair", "equipment")["order"], issue


def test_repair_cannot_override_assignee_and_wrong_person_cannot_finish(
    client: TestClient, settings
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_scoped_user("other-repair", None, role="repair", name="其他维修人员")
    order, _ = _created_order(api, ids, "identity-steal")
    assigned = api.advance(order, "assigned", assigneeId="other-repair")["order"]
    stolen = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {
            "expectedRev": assigned["rev"],
            "to": "repairing",
            "assigneeId": "demo-repair",
        },
        "identity-steal-accept",
        "demo-repair",
    )
    assert stolen.status_code == 409
    stored = next(row for row in api.get("/work-orders") if row["id"] == order["id"])
    assert stored["assigneeId"] == "other-repair"
    assert stored["status"] == "assigned"

    tampered = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {
            "expectedRev": assigned["rev"],
            "to": "repairing",
            "assigneeId": "other-repair",
        },
        "non-dispatch-assignee",
        "other-repair",
    )
    assert tampered.status_code == 409
    accepted = api.advance(assigned, "repairing", account="other-repair")
    assert accepted["order"]["status"] == "repairing"
    denied = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": accepted["order"]["rev"], "to": "submitted", "measures": "错人提交"},
        "wrong-person-submit",
        "demo-repair",
    )
    assert denied.status_code == 409
    submitted = api.advance(
        accepted["order"], "submitted", account="other-repair", measures="正确接单人提交"
    )
    assert submitted["order"]["acceptedById"] == "other-repair"


def test_same_name_different_id_is_not_authorized(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_scoped_user("demo-repair-2", None, role="repair", name="演示维修人员")
    order, _ = _created_order(api, ids, "identity-same-name")
    assigned = api.advance(order, "assigned", assigneeId="demo-repair-2")["order"]
    denied = api.fpost(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": assigned["rev"], "to": "repairing"},
        "same-name-wrong-id",
        "demo-repair",
    )
    assert denied.status_code == 409


def test_property_may_act_but_assignee_and_reason_are_preserved(
    client: TestClient, settings
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    order, _ = _created_order(api, ids, "identity-property")
    assigned = api.advance(order, "assigned", assigneeId="demo-repair")["order"]
    property_accept = api.advance(
        assigned,
        "repairing",
        account="demo-property",
        note="原维修人员外出，物业值班代接并说明原因",
    )
    assert property_accept["order"]["assigneeId"] == "demo-repair"
    assert property_accept["order"]["assignee"] == "演示维修人员"
    assert property_accept["order"]["acceptedById"] == "demo-property"
    submitted = api.advance(
        property_accept["order"],
        "submitted",
        account="demo-property",
        measures="物业代接后完成临时处置",
    )
    assert submitted["order"]["status"] == "submitted"
