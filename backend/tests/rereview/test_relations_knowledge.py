"""复审 RR3/RR7：显式工单关系覆盖旧问题上下文；知识检索异常不抛 500。"""

import json
from unittest.mock import patch

from assistant.fixtures import AssistantApi
from fastapi.testclient import TestClient


def _no_point_order(api: AssistantApi, ids: dict) -> tuple[dict, dict]:
    issue = api.report_issue(ids["manual"], pointId=None, submissionId="rereview-rel-a")["issue"]
    reviewed = api.review(issue, "to_repair", "general")
    return issue, reviewed["order"]


def test_explicit_order_binds_its_own_issue_not_old_context(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    first, order = _no_point_order(api, ids)
    other = api.report_issue(ids["manual"], submissionId="rereview-rel-b")["issue"]
    reply = api.raw_ask(
        f"{order['orderNo']} 现在怎么样",
        context={"pointId": ids["manual"]["id"], "issueId": other["id"]},
        key="rereview-order-context",
    )
    assert reply.status_code == 200, reply.text
    answer = reply.json()["data"]["answer"]
    assert answer["objects"]["issueId"] == first["id"]
    assert answer["objects"]["workOrderId"] == order["id"]
    facts = {row["label"]: row["value"] for row in answer["facts"]}
    assert first["issueNo"] in facts["问题"]
    assert other["issueNo"] not in json.dumps(answer, ensure_ascii=False)
    assert answer["conclusion"].startswith(f"问题 {first['issueNo']}")


def test_conflicting_explicit_order_and_issue_are_rejected(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    first, order = _no_point_order(api, ids)
    other = api.report_issue(ids["manual"], submissionId="rereview-rel-conflict")["issue"]
    reply = api.raw_ask(
        f"{order['orderNo']} {other['issueNo']} 现在怎么样",
        key="rereview-order-conflict",
    )
    assert reply.status_code == 200, reply.text
    answer = reply.json()["data"]["answer"]
    assert answer["status"] == "not_found"
    assert "关联不一致" in answer["conclusion"]
    assert answer["facts"] == []
    assert first["issueNo"] not in json.dumps(answer, ensure_ascii=False)


def test_knowledge_failure_keeps_business_failure_and_degrades(
    client: TestClient, settings
) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.82, minutes=-15)
    with patch("zhutong.operations.assistant.answer.compose._knowledge", return_value=None):
        missing = api.raw_ask("B99-F9-CRACK01 现在怎么样", key="rereview-k-missing")
        valid = api.raw_ask("B03-F2-CRACK01 现在怎么样", key="rereview-k-valid")
        concept = api.raw_ask("系统有哪些演示身份？", key="rereview-k-concept")
    assert missing.status_code == 200, missing.text
    assert missing.json()["data"]["answer"]["status"] == "not_found"
    assert valid.json()["data"]["answer"]["status"] == "answered"
    assert "0.82" in json.dumps(valid.json()["data"]["answer"]["facts"])
    assert concept.json()["data"]["answer"]["status"] == "unsupported"
    assert concept.json()["data"]["answer"]["knowledge"]["decision"] == "unavailable"
