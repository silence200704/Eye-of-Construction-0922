"""S5-10：业务写入、附件、审计与回执同事务，中途失败不得部分提交。"""

import pytest
from fastapi.testclient import TestClient

from ..attachments.test_attachments import issue_body, photo_spec
from ..fixtures import FieldApi, counts, today

TABLES = (
    "issues",
    "work_orders",
    "maintenance_tasks",
    "attachments",
    "audits",
    "operation_receipts",
)


def test_issue_audit_failure_rolls_back_issue_and_attachment(
    client: TestClient, settings, monkeypatch
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    photo = api.upload_photo(ids["manual"]["id"], key="tx-issue-photo")
    before = counts(str(settings.database_url), *TABLES)

    def fail(*_args, **_kwargs):
        raise RuntimeError("模拟问题审计写入故障")

    monkeypatch.setattr("zhutong.operations.field.issues.write_audit", fail)
    with pytest.raises(RuntimeError, match="模拟问题审计写入故障"):
        api.fpost(
            "/issues",
            issue_body(ids["manual"], "tx-issue", [photo_spec(photo, "tx-issue-draft")]),
            "tx-issue-command",
        )
    assert counts(str(settings.database_url), *TABLES) == before
    assert api.get("/issues") == []
    assert api.get("/attachments") == []


def test_order_audit_failure_rolls_back_status_and_photos(
    client: TestClient, settings, monkeypatch
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="tx-order")["issue"]
    order = api.review(issue, "to_repair", "equipment")["order"]
    order = api.advance(order, "assigned", assigneeId="demo-repair")["order"]
    order = api.advance(order, "repairing", account="demo-repair")["order"]
    photo = api.upload_photo(ids["manual"]["id"], key="tx-order-photo", account="demo-repair")
    before = counts(str(settings.database_url), *TABLES)

    def fail(*_args, **_kwargs):
        raise RuntimeError("模拟工单审计写入故障")

    monkeypatch.setattr("zhutong.operations.field.orders.write_audit", fail)
    with pytest.raises(RuntimeError, match="模拟工单审计写入故障"):
        api.advance(
            order,
            "submitted",
            account="demo-repair",
            measures="更换固定件",
            photos=[photo_spec(photo, "tx-order-draft")],
        )
    assert counts(str(settings.database_url), *TABLES) == before
    stored = next(row for row in api.get("/work-orders") if row["id"] == order["id"])
    assert stored["status"] == "repairing"
    assert stored["rev"] == order["rev"]
    assert stored["photos"] == []
    assert api.get("/attachments") == []


def test_maintenance_audit_failure_rolls_back_task_issue_and_photo(
    client: TestClient, settings, monkeypatch
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    api.create_maintenance_plan(ids["device"]["id"], ids["building"]["id"])
    task = api.generate_maintenance(day=today(), key="tx-maintenance")["created"][0]
    photo = api.upload_photo(ids["point"]["id"], key="tx-maintenance-photo")
    before = counts(str(settings.database_url), *TABLES)

    def fail(*_args, **_kwargs):
        raise RuntimeError("模拟保养审计写入故障")

    monkeypatch.setattr("zhutong.operations.field.maintenance.write_audit", fail)
    with pytest.raises(RuntimeError, match="模拟保养审计写入故障"):
        api.execute_maintenance(
            task,
            {
                "answers": [
                    {"key": "bolt", "result": "normal"},
                    {"key": "rust", "result": "abnormal"},
                ],
                "measures": "补涂防锈漆",
                "nextDueDate": "2026-11-01",
                "abnormalNote": "锚固端锈蚀",
                "createIssue": True,
                "photos": [photo_spec(photo, "tx-maintenance-draft")],
            },
            "tx-maintenance-execute",
        )
    assert counts(str(settings.database_url), *TABLES) == before
    stored = api.get("/maintenance/tasks")[0]
    assert stored["status"] == "pending"
    assert stored["execution"] is None
    assert api.get("/issues") == []
    assert api.get("/attachments") == []
