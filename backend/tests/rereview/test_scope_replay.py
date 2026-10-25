"""复审 RR1/RR5/RR6：幂等重放权限、无测点问题范围、完整记录聚合。"""

import json

from assistant.fixtures import AssistantApi
from fastapi.testclient import TestClient
from field.fixtures import counts
from sqlalchemy import create_engine, text


def change_scope(api: AssistantApi, account: str, scope: list[str]) -> None:
    engine = create_engine(api.database_url)
    with engine.begin() as db:
        db.execute(
            text("UPDATE users SET building_ids_json=:scope WHERE id=:id"),
            {"id": account, "scope": json.dumps(scope)},
        )
    engine.dispose()


def test_replayed_answer_respects_current_scope(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.82, minutes=-15)
    account = "rereview-replay"
    api.add_scoped_user(account, [ids["building"]["id"]], role="safety")
    question = "B03-F2-CRACK01 现在怎么样"
    first = api.raw_ask(question, key="rereview-private", account=account)
    assert first.status_code == 200, first.text
    session_id = first.json()["data"]["sessionId"]
    before = counts(api.database_url, "assistant_turns", "audits", "operation_receipts", "records")
    change_scope(api, account, [])
    replay = api.raw_ask(question, key="rereview-private", account=account)
    assert replay.status_code == 200, replay.text
    assert replay.json()["replayed"] is True
    answer = replay.json()["data"]["answer"]
    assert answer["historical"] is True
    assert answer["facts"] == []
    assert answer["objects"]["pointId"] is None
    assert "0.82" not in json.dumps(answer, ensure_ascii=False)
    restored = api.client.get(
        f"/api/v1/datasets/demo-main/assistant/sessions/{session_id}",
        headers={"Authorization": f"Bearer {api.token_for(account)}"},
    )
    assert restored.json()["data"]["turns"][0]["answer"]["historical"] is True
    after = counts(api.database_url, "assistant_turns", "audits", "operation_receipts", "records")
    assert after == before


def test_replayed_knowledge_is_redacted_after_role_narrowing(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    account = "rereview-role"
    api.add_scoped_user(account, [ids["building"]["id"]], role="safety")
    title = "复审角色知识"
    content = "# 复审角色知识\n\n这条知识只允许安全管理人员查看。"
    doc = api.knowledge_doc(title, content, roles=["safety"])
    question = "复审角色知识是什么？"
    api.knowledge_faq(doc["chunks"][0]["id"], [question], "rereview-role-faq")
    first = api.raw_ask(question, key="rereview-role", account=account)
    assert first.status_code == 200, first.text
    assert first.json()["data"]["answer"]["citations"]
    engine = create_engine(api.database_url)
    with engine.begin() as db:
        db.execute(text("UPDATE users SET role='repair' WHERE id=:id"), {"id": account})
    engine.dispose()
    replay = api.raw_ask(question, key="rereview-role", account=account)
    assert replay.status_code == 200, replay.text
    answer = replay.json()["data"]["answer"]
    assert answer["historical"] is True
    assert answer["citations"] == []
    assert title not in json.dumps(answer, ensure_ascii=False)


def test_replayed_media_is_rejected_after_archive(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point_id = ids["point"]["id"]
    media = api.upload_photo(point_id, key="rereview-frame-media")
    body = {"pointId": point_id, "mediaId": media["id"], "label": "复审"}
    frame = api.fpost("/media-sessions/frames", body, "rereview-frame")
    assert frame.status_code == 200, frame.text
    before = counts(api.database_url, "media_frames", "audits", "operation_receipts")
    engine = create_engine(api.database_url)
    with engine.begin() as db:
        db.execute(text("UPDATE points SET status='archived' WHERE id=:id"), {"id": point_id})
    engine.dispose()
    replay = api.fpost("/media-sessions/frames", body, "rereview-frame")
    assert replay.status_code == 404, replay.text
    after = counts(api.database_url, "media_frames", "audits", "operation_receipts")
    assert after == before


def test_unbound_issue_and_order_do_not_leak_into_empty_scope(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], pointId=None, submissionId="rereview-no-point")["issue"]
    assert issue["buildingId"] == ids["building"]["id"]
    api.review(issue, "to_repair", "general")
    account = "rereview-empty"
    api.add_scoped_user(account, [], role="safety")
    headers = {"Authorization": f"Bearer {api.token_for(account)}"}
    overview = api.raw_ask("全校现在概况如何", key="rereview-empty-overview", account=account)
    assert overview.status_code == 200, overview.text
    facts = {row["label"]: row["value"] for row in overview.json()["data"]["answer"]["facts"]}
    assert facts["在册楼栋 / 测点 / 设备"] == "0 / 0 / 0"
    assert facts["未关闭事件 / 问题 / 工单"] == "0 / 0 / 0"
    listing = api.client.get("/api/v1/datasets/demo-main/issues", headers=headers)
    assert listing.status_code == 200, listing.text
    assert listing.json()["data"] == []


def test_overview_aggregates_every_authorized_record(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.82, minutes=-15)
    for index in range(21):
        point = api.ok(
            api.post(
                "/points",
                {
                    "code": f"B03-F2-COUNT{index + 1:02}",
                    "name": f"计数测点{index + 1}",
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
        expected = db.execute(
            text("SELECT count(*) FROM records WHERE dataset_id='demo-main' AND quality='valid'")
        ).scalar_one()
    engine.dispose()
    overview = api.ask("全校现在概况如何", key="rereview-count")["answer"]
    facts = {row["label"]: row["value"] for row in overview["facts"]}
    assert expected == 22
    assert facts["有效监测记录"] == "22"


def test_overview_counts_authorized_building_without_points(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.ok(
        api.post(
            "/buildings",
            {
                "code": "B99",
                "name": "空档案楼",
                "purpose": "实验",
                "footprint": {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.1, "rotate": 0},
            },
        )
    )
    overview = api.ask("全校现在概况如何", key="rereview-empty-building")["answer"]
    facts = {row["label"]: row["value"] for row in overview["facts"]}
    assert facts["在册楼栋 / 测点 / 设备"].startswith("2 / 2 /")
    assert "空档案楼" not in json.dumps(overview, ensure_ascii=False)
    assert ids["building"]["id"] != ""


def test_media_replay_rechecks_media_ownership_after_role_change(
    client: TestClient, settings
) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    building = ids["building"]["id"]
    point = ids["point"]["id"]
    api.add_scoped_user("media-owner", [building], role="inspector")
    api.add_scoped_user("media-reader", [building], role="safety")
    media = api.upload_photo(account="media-owner", file_name="owner-private.png")
    body = {"pointId": point, "mediaId": media["id"], "label": "private-frame"}
    first = api.fpost("/media-sessions/frames", body, "role-frame", "media-reader")
    assert first.status_code == 200, first.text
    engine = create_engine(api.database_url)
    with engine.begin() as db:
        db.execute(text("UPDATE users SET role='device' WHERE id='media-reader'"))
    engine.dispose()
    headers = {"Authorization": f"Bearer {api.token_for('media-reader')}"}
    listing = api.client.get("/api/v1/datasets/demo-main/media-sessions/frames", headers=headers)
    assert listing.json()["data"] == []
    fresh = api.fpost("/media-sessions/frames", body, "role-new", "media-reader")
    assert fresh.status_code == 403, fresh.text
    before = counts(api.database_url, "media_frames", "audits", "operation_receipts")
    replay = api.fpost("/media-sessions/frames", body, "role-frame", "media-reader")
    assert replay.status_code in {403, 404}, replay.text
    assert "owner-private.png" not in replay.text
    after = counts(api.database_url, "media_frames", "audits", "operation_receipts")
    assert after == before
