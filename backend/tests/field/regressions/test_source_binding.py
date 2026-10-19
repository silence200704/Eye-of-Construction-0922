"""R5-03：来源字段不可伪造，事件关闭只接受当前事件的合法处置链。"""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from ..fixtures import FieldApi


def _recovery(api: FieldApi, point_id: str) -> None:
    for index, width in enumerate((0.54, 0.55, 0.56)):
        api.add_record(point_id, width, minutes=-20 + index * 2)


def test_manual_report_cannot_carry_event(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-40)
    event = api.get("/events")[0]
    response = api.fpost(
        "/issues",
        {
            "source": "report",
            "pointId": ids["point"]["id"],
            "buildingId": ids["building"]["id"],
            "floorId": ids["floor"]["id"],
            "anomalyType": "裂缝",
            "description": "人工上报不能指定事件",
            "submissionId": "forged-event",
            "eventId": event["id"],
        },
        "forged-event",
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert api.get("/issues") == []


def test_close_rejects_work_order_from_another_point(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.82, minutes=-40)
    event = api.get("/events")[0]
    issue = api.report_issue(ids["manual"], submissionId="other-point-order")["issue"]
    order = api.review(issue, "to_repair", "equipment")["order"]
    order = api.advance(order, "assigned", assigneeId="demo-repair")["order"]
    order = api.advance(order, "repairing", account="demo-repair")["order"]
    order = api.advance(order, "submitted", account="demo-repair", measures="另一个人工测点的维修")[
        "order"
    ]
    order = api.advance(order, "verified", note="另一个测点验收")["order"]
    engine = create_engine(str(settings.database_url))
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE work_orders SET event_id=:event WHERE id=:id"),
            {"event": event["id"], "id": order["id"]},
        )
    engine.dispose()
    _recovery(api, ids["point"]["id"])
    event = api.get("/events")[0]
    response = api.fpost(
        f"/events/{event['id']}/close",
        {
            "expectedRev": event["rev"],
            "basis": "试图用另一个测点的工单关闭",
            "noRepairNote": "",
        },
        "forged-close",
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "CLOSE_BASIS_REQUIRED"
    assert api.get("/events")[0]["status"] != "closed"


def test_sensor_issue_can_use_current_event_order(client: TestClient, settings) -> None:
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
            "description": "合法的传感器问题",
            "submissionId": "sensor-legal",
            "eventId": event["id"],
        },
        "sensor-legal",
    )["issue"]
    order = api.review(issue, "to_repair", "equipment")["order"]
    order = api.advance(order, "assigned", assigneeId="demo-repair")["order"]
    order = api.advance(order, "repairing", account="demo-repair")["order"]
    order = api.advance(order, "submitted", account="demo-repair", measures="更换固定件")["order"]
    api.advance(order, "verified", note="传感器事件工单验收")
    _recovery(api, ids["point"]["id"])
    current = api.get("/events")[0]
    closed = api.ok_post(
        f"/events/{current['id']}/close",
        {
            "expectedRev": current["rev"],
            "basis": "恢复复测与当前事件工单验收完成",
            "noRepairNote": "",
        },
        "sensor-legal-close",
    )
    assert closed["status"] == "closed"
    assert closed["closedAt"] is not None
