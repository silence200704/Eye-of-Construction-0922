"""S7-07 / S7-02：会话持久化、按身份隔离、知识引用与降级。"""

from fastapi.testclient import TestClient
from field.fixtures import token_of

from .fixtures import AssistantApi


def test_query_persists_turn_and_can_be_read_back(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.42, minutes=-30)
    reply = api.ask("B03-F2-CRACK01 现在怎么样", key="session-first")
    session_id = reply["sessionId"]
    api.ask("现在有哪些未处理预警", context={"source": "previous"}, key="session-second")
    listing = api.get("/assistant/sessions")
    assert any(row["id"] == session_id for row in listing)
    detail = api.get(f"/assistant/sessions/{session_id}")
    assert detail["turnCount"] == 2
    assert [turn["question"] for turn in detail["turns"]][0] == "B03-F2-CRACK01 现在怎么样"
    restored = detail["turns"][0]["answer"]
    assert restored["objects"]["pointId"] == ids["point"]["id"]
    assert restored["sources"]["facts"] == "server_db"


def test_sessions_are_isolated_by_identity(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.42, minutes=-30)
    reply = api.ask("B03-F2-CRACK01 现在怎么样", key="session-iso")
    session_id = reply["sessionId"]
    other = api.raw_ask(
        "B03-F2-CRACK01 现在怎么样", None, "session-iso-other", "demo-repair"
    ).json()["data"]
    assert other["sessionId"] != session_id
    mine = [row["id"] for row in api.get("/assistant/sessions")]
    assert session_id in mine
    detail = api.client.get(
        f"/api/v1/datasets/demo-main/assistant/sessions/{session_id}",
        headers={"Authorization": f"Bearer {token_of(api.client, 'demo-repair')}"},
    )
    assert detail.status_code == 404


def test_knowledge_question_returns_citations_when_index_ready(
    client: TestClient, settings
) -> None:
    api = AssistantApi(client, str(settings.database_url))
    doc = api.knowledge_doc(
        "预警分级与处置要求",
        (
            "# 预警分级\n\n"
            "红色为紧急核查门槛，需要学校安全管理人员立即确认并组织核查。\n"
            "确认后进入处理中，处置完成后仍需恢复复测满足条件才能关闭。"
        ),
        source_path="docs/knowledge/分级.md",
    )
    api.knowledge_faq(doc["chunks"][0]["id"], ["预警分级里红色代表什么要求"])
    api.rebuild_knowledge()
    answer = api.raw_ask("预警分级里红色代表什么要求", None, "assistant-knowledge-ask").json()[
        "data"
    ]["answer"]
    assert answer["intent"] == "knowledge"
    assert answer["status"] == "answered"
    assert answer["facts"] == []
    assert answer["citations"]
    citation = answer["citations"][0]
    assert citation["chunkId"] and citation["sha256"] and citation["version"] >= 1
    assert answer["knowledge"]["decision"] == "answer"
    assert answer["sources"] == {
        "facts": "none",
        "knowledge": "local_kb",
        "queriedAt": answer["sources"]["queriedAt"],
    }
    assert "红色" in answer["conclusion"]


def test_business_answer_keeps_facts_and_knowledge_sources_separate(
    client: TestClient, settings
) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.42, minutes=-30)
    doc = api.knowledge_doc(
        "裂缝判定标准",
        "# 裂缝判定\n\n裂缝宽度按现行规则分级，黄色、橙色、红色阈值以启用规则为准。",
        source_path="docs/knowledge/裂缝.md",
    )
    api.knowledge_faq(doc["chunks"][0]["id"], ["B03-F2-CRACK01 的裂缝判定标准是什么"])
    api.rebuild_knowledge()
    answer = api.ask("B03-F2-CRACK01 的裂缝判定标准是什么", key="assistant-mixed")["answer"]
    assert answer["intent"] == "point_status"
    assert answer["objects"]["pointId"] == ids["point"]["id"]
    assert answer["sources"]["facts"] == "server_db"
    assert answer["sources"]["knowledge"] == "local_kb"
    values = {row["label"]: row["value"] for row in answer["facts"]}
    assert values["当前读数"] == "0.42"
    assert answer["citations"] and answer["knowledge"]["decision"] == "answer"


def test_no_basis_question_does_not_fabricate(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    api.seed_manual_point()
    answer = api.raw_ask("学校食堂下周菜单是什么", None, "assistant-menu").json()["data"]["answer"]
    assert answer["intent"] == "knowledge"
    assert answer["status"] == "unsupported"
    assert answer["facts"] == []
    assert answer["citations"] == []
    assert answer["knowledge"]["decision"] == "no_basis"
    assert "没有足够依据" in answer["conclusion"]
