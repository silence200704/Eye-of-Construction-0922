"""阶段7返修复审：独立临时库，真实ASGI路由；不操作交付库。"""

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "backend/src"), str(ROOT / "backend/tests")]

from assistant.fixtures import AssistantApi  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from zhutong.app import create_app  # noqa: E402
from zhutong.bootstrap import initialize  # noqa: E402
from zhutong.core.settings import Settings  # noqa: E402

PREFIX = "/api/v1/datasets/demo-main"


def out(response):
    return {"status": response.status_code, "response": response.json()}


def ask(api, question, *, account="demo-safety", key="rereview"):
    return api.raw_ask(question, key=key, account=account)


def change_scope(api, account, scope):
    engine = create_engine(api.database_url)
    with engine.begin() as db:
        db.execute(
            text("UPDATE users SET building_ids_json=:scope WHERE id=:id"),
            {"id": account, "scope": json.dumps(scope)},
        )
    engine.dispose()


def replay_after_revoke(api, ids):
    account = "rereview-revoked"
    api.add_scoped_user(account, [ids["building"]["id"]], role="safety")
    question = "B03-F2-CRACK01 现在怎么样"
    first = ask(api, question, account=account, key="private-answer")
    assert first.status_code == 200, first.text
    change_scope(api, account, [])
    fresh = ask(api, question, account=account, key="private-answer-fresh")
    session_id = first.json()["data"]["sessionId"]
    restored = api.client.get(
        PREFIX + "/assistant/sessions/" + session_id,
        headers={"Authorization": "Bearer " + api.token_for(account)},
    )
    replayed = ask(api, question, account=account, key="private-answer")
    return {"fresh": out(fresh), "restored": out(restored), "replayed": out(replayed)}


def unbound_scope(api, ids):
    reported = api.report_issue(ids["manual"], pointId=None, submissionId="rereview-no-point")
    issue = reported["issue"]
    reviewed = api.review(issue, "to_repair", "general")
    account = "rereview-empty"
    api.add_scoped_user(account, [], role="safety")
    headers = {"Authorization": "Bearer " + api.token_for(account)}
    result = ask(api, "全校现在概况如何", account=account, key="empty-overview")
    listing = api.client.get(PREFIX + "/issues", headers=headers)
    return {
        "seededIssue": issue,
        "reviewed": reviewed,
        "authoritativeIssueListing": out(listing),
        "assistantOverview": out(result),
    }


def knowledge_failure(api):
    with patch("zhutong.operations.assistant.answer.compose._knowledge", return_value=None):
        response = ask(api, "B99 的裂缝测点现在怎么样", key="knowledge-down")
    return {
        "fault": "knowledge retrieval returns None, as its exception handler does",
        "result": out(response),
    }


def mixed_objects(api, ids, unbound):
    other = api.report_issue(ids["manual"], submissionId="rereview-second-issue")["issue"]
    order = unbound["reviewed"]["order"]
    response = api.raw_ask(
        f"{order['orderNo']} 现在怎么样",
        context={"pointId": ids["manual"]["id"], "issueId": other["id"]},
        key="explicit-order-old-issue",
    )
    return {
        "order": order,
        "actualOrderIssue": unbound["seededIssue"]["id"],
        "oldContextIssue": other["id"],
        "result": out(response),
    }


def count_over_twenty(api, ids):
    for n in range(21):
        point = api.ok(
            api.post(
                "/points",
                {
                    "code": f"B03-F2-EXTRA{n + 1:02}",
                    "name": f"额外裂缝{n + 1}",
                    "buildingId": ids["building"]["id"],
                    "floorId": ids["floor"]["id"],
                    "type": "crack",
                    "coord": {"x": 0.2, "y": 0.2},
                },
            )
        )
        api.add_record(point["id"], 0.6, minutes=-10)
    engine = create_engine(api.database_url)
    with engine.connect() as db:
        actual = db.execute(
            text("SELECT count(*) FROM records WHERE dataset_id='demo-main' AND quality='valid'")
        ).scalar_one()
    engine.dispose()
    return {
        "databaseValidRecords": actual,
        "assistant": out(ask(api, "全校现在概况如何", key="count-over-twenty")),
    }


def main():
    with TemporaryDirectory(prefix="zhutong-s7-rereview-") as folder:
        runtime = Path(folder)
        settings = Settings(
            runtime_dir=runtime, database_url=f"sqlite:///{(runtime / 'review.sqlite').as_posix()}"
        )
        initialize(settings)
        with TestClient(create_app(settings), raise_server_exceptions=False) as client:
            api = AssistantApi(client, str(settings.database_url))
            ids = api.seed_manual_point()
            api.add_record(ids["point"]["id"], 0.82, minutes=-15)
            unbound = unbound_scope(api, ids)
            data = {
                "method": "independent temporary SQLite; ASGI TestClient, not TCP/browser",
                "reviewedHead": "1e6c8a5",
                "revokedReplay": replay_after_revoke(api, ids),
                "unboundScope": unbound,
                "mixedObjects": mixed_objects(api, ids, unbound),
                "knowledgeFailure": knowledge_failure(api),
                "overviewCount": count_over_twenty(api, ids),
            }
    target = Path(__file__).with_name("results.json")
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("review evidence saved", target)


if __name__ == "__main__":
    main()
