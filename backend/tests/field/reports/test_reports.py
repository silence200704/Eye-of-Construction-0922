"""S5-11：三项指标、明细导出与单事件报告均从数据库明细重算。"""

from datetime import date, timedelta

from fastapi.testclient import TestClient

from ..fixtures import FieldApi, today
from ..orders.test_orders import _order_flow


def _sensor_payload(ids: dict, event: dict) -> dict:
    return {
        "source": "sensor",
        "pointId": ids["point"]["id"],
        "buildingId": ids["building"]["id"],
        "floorId": ids["floor"]["id"],
        "zoneId": "",
        "anomalyType": "裂缝越限",
        "description": "预警事件转问题",
        "submissionId": "report-sensor-" + event["id"],
        "eventId": event["id"],
    }


def test_indicators_and_exports_recompute_from_database(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point = ids["manual"]

    closed_no_recheck = api.report_issue(point, submissionId="metric-no-recheck")["issue"]
    api.review(closed_no_recheck, "close_no_fault", "no_fault")

    repaired = api.report_issue(point, submissionId="metric-repaired")["issue"]
    order = _order_flow(api, repaired)
    api.advance(order, "verified", note="现场复看合格")
    current = next(row for row in api.get("/issues") if row["id"] == repaired["id"])
    current = api.register_recheck(current, dueDate=today())["issue"]
    api.recheck_outcome(current, "recovered")

    observing = api.report_issue(point, submissionId="metric-observing")["issue"]
    observing = api.review(observing, "recheck", "remeasure")["issue"]
    observing = api.register_recheck(observing, dueDate=today())["issue"]
    api.recheck_outcome(observing, "observing", nextDueDate=today())

    late_issue = api.report_issue(point, submissionId="metric-late")["issue"]
    late_issue = api.review(late_issue, "recheck", "remeasure")["issue"]
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    late_issue = api.register_recheck(late_issue, dueDate=yesterday)["issue"]
    api.recheck_outcome(late_issue, "recovered")

    api.create_maintenance_plan(ids["device"]["id"], ids["building"]["id"])
    task = api.generate_maintenance(day=today(), key="metric-mgen")["created"][0]
    api.execute_maintenance(
        task,
        {
            "answers": [
                {"key": "bolt", "result": "normal"},
                {"key": "rust", "result": "normal"},
            ],
            "measures": "紧固并清洁",
            "nextDueDate": (date.today() + timedelta(days=30)).isoformat(),
        },
        "metric-maintenance",
    )
    api.generate_maintenance(
        day=(date.today() + timedelta(days=1)).isoformat(), key="metric-mgen-pending"
    )

    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    event = api.get("/events")[0]
    api.ok(api.post(f"/events/{event['id']}/acknowledge", {"expectedRev": event["rev"]}))

    data = api.get("/reports/indicators")
    response, closure, periodic = data["indicators"]
    assert response["key"] == "response"
    assert response["denominator"]["value"] == 1
    assert response["exclusions"][0]["count"] == 0
    assert closure["denominator"]["value"] == 2
    assert closure["numerator"]["value"] == 1
    assert closure["value"] == 0.5
    assert closure["exclusions"][0]["count"] == 1
    assert closure["exclusions"][1]["count"] == 1
    assert periodic["numerator"]["value"] == 3
    assert periodic["denominator"]["value"] == 4
    assert periodic["value"] == 0.75
    assert periodic["exclusions"][0]["count"] == 1
    assert periodic["exclusions"][1]["count"] == 1

    issues = api.get("/reports/export", kind="issues")
    assert issues["count"] == 4
    assert issues["header"][0] == "问题编号"
    assert len(issues["rows"]) == 4
    filtered = api.get("/reports/export", kind="issues", status="observing")
    assert filtered["count"] == 1
    assert filtered["rows"][0][5] == "观察中"
    orders = api.get("/reports/export", kind="orders")
    assert orders["count"] == 1
    assert orders["rows"][0][3] == "已验收"
    maintenance = api.get("/reports/export", kind="maintenance")
    assert maintenance["count"] == 2
    rechecks = api.get("/reports/export", kind="rechecks")
    assert rechecks["count"] == 4
    with_rechecks = [row for row in rechecks["rows"] if row[6] == "恢复"]
    assert len(with_rechecks) == 2


def test_task_export_keeps_partial_completion_separate(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    other = api.ok(
        api.post(
            "/points",
            {
                "code": "B03-F2-CHECK02",
                "name": "第二人工检查点",
                "buildingId": ids["building"]["id"],
                "floorId": ids["floor"]["id"],
                "type": "manual_check",
                "coord": {"x": 0.6, "y": 0.6},
            },
            key="report-second-point",
        )
    )
    api.create_plan(
        ids["manual"]["id"],
        ids["building"]["id"],
        ids["floor"]["id"],
        pointIds=[ids["manual"]["id"], other["id"]],
    )
    api.generate(key="report-task-generate")
    task = api.task_for_point(ids["manual"]["id"])
    point = ids["manual"]
    arrived = api.ok_post(
        f"/inspection/tasks/{task['id']}/check-in",
        {
            "expectedRev": task["rev"],
            "pointId": point["id"],
            "method": "nfc",
            "labelRead": point["nfc"]["code"],
            "fallbackReason": "",
        },
        "report-task-check-in",
        "demo-inspector",
    )
    completed = api.ok_post(
        f"/inspection/tasks/{task['id']}/complete-point",
        {
            "expectedRev": arrived["task"]["rev"],
            "pointId": point["id"],
            "answers": [{"key": "wall", "label": "墙面", "result": "ok", "note": ""}],
            "linkedIssueId": None,
            "noIssueReason": "",
        },
        "report-task-complete",
        "demo-inspector",
    )
    assert completed["task"]["status"] == "partial"
    rows = api.get("/reports/export", kind="tasks")
    assert rows["count"] == 1
    assert rows["rows"][0][5] == "部分完成"
    assert rows["rows"][0][6] == "1/2"
    data = api.get("/reports/indicators")
    assert data["indicators"][1]["value"] is None


def test_event_report_is_built_from_live_rows(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    event = api.get("/events")[0]
    issue = api.ok_post(
        "/issues",
        _sensor_payload(ids, event),
        "report-event-issue",
    )["issue"]
    order = _order_flow(api, issue)
    api.advance(order, "verified", note="现场复看合格")
    for value, minute in ((0.54, -20), (0.55, -18), (0.56, -16)):
        api.add_record(ids["point"]["id"], value, minutes=minute)
    event = api.get("/events")[0]
    closed = api.ok(
        api.post(
            f"/events/{event['id']}/close",
            {
                "expectedRev": event["rev"],
                "basis": "连续恢复复测与工单验收",
                "noRepairNote": "",
            },
        )
    )
    assert closed["status"] == "closed"

    report = api.get(f"/reports/events/{event['id']}")
    assert report["closed"] is True
    assert len(report["sections"]) == 4
    assert report["sections"][0]["title"] == "一、事件与证据"
    assert report["sections"][3]["title"] == "四、关闭依据"
    close_row = next(row for row in report["sections"][3]["rows"] if row["label"] == "关闭依据")
    assert close_row["value"] == "连续恢复复测与工单验收"
    timeline_text = " ".join(row["detail"] for row in report["timeline"])
    assert "已验收通过" in timeline_text
    actions = [row["action"] for row in report["timeline"]]
    assert any(action.startswith("问题 ") for action in actions)
    assert any(action.startswith("工单 ") for action in actions)
