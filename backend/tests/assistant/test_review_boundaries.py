"""R1—R4：范围/会话/对象边界与写命令回归（审核原缺陷的稳定断言）。"""

import json

from fastapi.testclient import TestClient
from field.fixtures import counts
from sqlalchemy import create_engine, text

from .fixtures import AssistantApi


def _frame(api: AssistantApi, point_id: str, key: str) -> dict:
    media = api.upload_photo(point_id, key=f"media-{key}")
    response = api.fpost(
        "/media-sessions/frames",
        {"pointId": point_id, "mediaId": media["id"], "label": key},
        f"frame-{key}",
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _comparison(api: AssistantApi, point_id: str, before: str, after: str, key: str):
    return api.fpost(
        "/media-sessions/comparisons",
        {
            "pointId": point_id,
            "beforeId": before,
            "afterId": after,
            "result": {"changedRatio": 0.1},
        },
        key,
    )


def _ask(api: AssistantApi, question: str, key: str, **extra):
    return api.fpost(
        "/assistant/query",
        {"question": question, "context": {}, **extra},
        key,
    )


def test_empty_scope_filters_media_lists_and_cases(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point_id = ids["point"]["id"]
    first = _frame(api, point_id, "scope-a")
    second = _frame(api, point_id, "scope-b")
    saved = _comparison(api, point_id, first["id"], second["id"], "scope-comparison")
    assert saved.status_code == 200, saved.text
    issue = api.report_issue(ids["manual"], submissionId="scope-case")["issue"]
    api.add_scoped_user("review-empty-scope", [], role="safety")
    for suffix in ("/media-sessions/frames", "/media-sessions/comparisons"):
        data = api.client.get(
            f"/api/v1/datasets/demo-main{suffix}",
            headers={"Authorization": f"Bearer {api.token_for('review-empty-scope')}"},
        )
        assert data.status_code == 200, data.text
        assert data.json()["data"] == []
    summary = api.client.get(
        "/api/v1/datasets/demo-main/media-sessions/summary",
        headers={"Authorization": f"Bearer {api.token_for('review-empty-scope')}"},
    )
    assert summary.status_code == 200
    assert summary.json()["data"]["frames"] == []
    assert summary.json()["data"]["comparisons"] == []
    answer = api.raw_ask("有没有类似裂缝案例", None, "scope-case", "review-empty-scope")
    assert answer.status_code == 200, answer.text
    assert answer.json()["data"]["answer"]["extras"]["cases"] == []
    assert issue["id"] not in answer.text


def test_revoked_scope_redacts_old_turn_and_epoch_invalidates_session(
    client: TestClient, settings
) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.82, minutes=-15)
    api.add_scoped_user("review-revoked", [ids["building"]["id"]], role="safety")
    original = api.raw_ask(
        "B03-F2-CRACK01 现在怎么样", None, "revoke-original", "review-revoked"
    ).json()["data"]
    engine = create_engine(str(settings.database_url))
    with engine.begin() as db:
        db.execute(text("UPDATE users SET building_ids_json='[]' WHERE id='review-revoked'"))
    engine.dispose()
    detail = api.client.get(
        f"/api/v1/datasets/demo-main/assistant/sessions/{original['sessionId']}",
        headers={"Authorization": f"Bearer {api.token_for('review-revoked')}"},
    )
    assert detail.status_code == 200, detail.text
    restored = detail.json()["data"]["turns"][0]["answer"]
    assert restored["status"] == "not_found"
    assert restored["facts"] == []
    assert restored["objects"]["pointId"] is None
    assert "0.82" not in detail.text
    fresh = api.raw_ask("B03-F2-CRACK01 现在怎么样", None, "revoke-fresh", "review-revoked").json()[
        "data"
    ]["answer"]
    assert fresh["status"] == "not_found"

    current = api.ask("B03-F2-CRACK01 现在怎么样", key="epoch-original")
    engine = create_engine(str(settings.database_url))
    with engine.begin() as db:
        db.execute(text("UPDATE datasets SET epoch=epoch+1 WHERE id='demo-main'"))
        epoch = db.execute(text("SELECT epoch FROM datasets WHERE id='demo-main'")).scalar_one()
    engine.dispose()
    api.epoch = epoch
    stale = api.client.get(
        f"/api/v1/datasets/demo-main/assistant/sessions/{current['sessionId']}",
        headers=api.auth(),
    )
    assert stale.status_code == 410, stale.text
    reused = _ask(api, "全校现在概况如何", "epoch-reuse", sessionId=current["sessionId"])
    assert reused.status_code == 410, reused.text
    missing = _ask(api, "全校现在概况如何", "missing-session", sessionId="as_missing")
    assert missing.status_code == 404, missing.text


def test_explicit_building_and_unique_event_stay_bound(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_red_event()
    event = ids["event"]
    foreign = api.ask("B99 的裂缝测点现在怎么样", key="object-b99")["answer"]
    assert foreign["status"] == "not_found"
    assert foreign["objects"]["pointId"] is None
    assert "0.82" not in foreign["conclusion"]
    current = api.ask("B03-F2-CRACK01 现在怎么样", key="object-current")["answer"]
    assert current["objects"]["pointId"] == ids["point"]["id"]
    assert current["objects"]["eventId"] == event["id"]
    follow = api.ask(
        "这条预警为什么被触发",
        context={"pointId": ids["point"]["id"], "source": "previous"},
        key="object-followup",
    )["answer"]
    assert follow["intent"] == "event_reason"
    assert follow["objects"]["eventId"] == event["id"]


def test_write_commands_replay_reject_stale_epoch_and_audit(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    tables = (
        "assistant_turns",
        "media_frames",
        "media_comparisons",
        "audits",
        "operation_receipts",
    )
    before = counts(str(settings.database_url), *tables)
    first = _ask(api, "全校现在概况如何", "write-replay")
    assert first.status_code == 200, first.text
    second = _ask(api, "全校现在概况如何", "write-replay")
    assert second.status_code == 200, second.text
    assert second.json()["data"]["turnId"] == first.json()["data"]["turnId"]
    assert second.json()["replayed"] is True
    changed = _ask(api, "现在有哪些未处理预警", "write-replay")
    assert changed.status_code == 409, changed.text
    stale = api.client.post(
        "/api/v1/datasets/demo-main/assistant/query",
        json={"question": "全校现在概况如何", "context": {}},
        headers={**api.auth(), "Idempotency-Key": "write-stale", "X-Dataset-Epoch": "999"},
    )
    assert stale.status_code == 409, stale.text
    point_id = ids["point"]["id"]
    first_frame = _frame(api, point_id, "write-frame")
    media = api.upload_photo(point_id, key="write-frame-other")
    replay_frame = api.fpost(
        "/media-sessions/frames",
        {"pointId": point_id, "mediaId": media["id"], "label": "write-frame"},
        "frame-write-frame",
    )
    assert replay_frame.status_code == 409, replay_frame.text
    other = _frame(api, point_id, "write-frame-other")
    comparison = _comparison(api, point_id, first_frame["id"], other["id"], "write-comparison")
    assert comparison.status_code == 200, comparison.text
    replay_comparison = _comparison(
        api, point_id, first_frame["id"], other["id"], "write-comparison"
    )
    assert replay_comparison.status_code == 200, replay_comparison.text
    assert replay_comparison.json()["data"]["id"] == comparison.json()["data"]["id"]
    assert replay_comparison.json()["replayed"] is True
    after = counts(str(settings.database_url), *tables)
    assert after["assistant_turns"] - before["assistant_turns"] == 1
    assert after["media_frames"] - before["media_frames"] == 2
    assert after["media_comparisons"] - before["media_comparisons"] == 1
    assert after["operation_receipts"] - before["operation_receipts"] == 4
    assert after["audits"] - before["audits"] >= 4


def test_failed_command_rolls_back_business_receipt_and_audit(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    media = api.upload_photo(ids["point"]["id"], key="rollback-media")
    before = counts(str(settings.database_url), "media_frames", "audits", "operation_receipts")
    failed = api.fpost(
        "/media-sessions/frames",
        {"pointId": "pnt_missing", "mediaId": media["id"]},
        "rollback-frame",
    )
    assert failed.status_code == 404, failed.text
    after = counts(str(settings.database_url), "media_frames", "audits", "operation_receipts")
    assert after == before
    assert json.loads(failed.text)["ok"] is False


def test_candidate_click_resolves_same_question_without_asking_again(
    client: TestClient, settings
) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_red_event()
    other = api.ok(
        api.post(
            "/points",
            {
                "code": "B03-F2-CRACK02",
                "name": "第二裂缝测点",
                "buildingId": ids["building"]["id"],
                "floorId": ids["floor"]["id"],
                "type": "crack",
                "coord": {"x": 0.6, "y": 0.6},
            },
            key="choice-second-point",
        )
    )
    first = api.ask("裂缝测点现在怎么样", key="choice-list")["answer"]
    assert first["status"] == "need_choice"
    assert {row["id"] for row in first["candidates"]} == {ids["point"]["id"], other["id"]}
    picked = api.ask(
        "裂缝测点现在怎么样", {"pointId": other["id"], "source": "page"}, key="choice-pick"
    )["answer"]
    assert picked["status"] == "answered", picked
    assert picked["objects"]["pointId"] == other["id"]
    assert "0.82" not in json.dumps(picked["facts"])
