"""R6/R7/R9：知识入口、权威判定/试算与结构化事实版本。"""

import json
from pathlib import Path

from fastapi.testclient import TestClient
from field.fixtures import counts
from sqlalchemy import create_engine, text

from .fixtures import AssistantApi

CORPUS = json.loads((Path(__file__).resolve().parents[2] / "resources/knowledge/corpus.json").read_text("utf-8"))


def seed_corpus(api: AssistantApi) -> None:
    for item in CORPUS:
        doc = api.knowledge_doc(item["title"], item["content"], item["sourcePath"])
        api.knowledge_faq(doc["chunks"][0]["id"], item["faq"])


def _ask(api: AssistantApi, question: str, key: str, **context):
    return api.fpost("/assistant/query", {"question": question, "context": context}, key).json()[
        "data"
    ]["answer"]


def test_twenty_standard_faqs_answer_through_assistant(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    seed_corpus(api)
    answered = []
    for index, item in enumerate(CORPUS):
        answer = _ask(api, item["faq"][0], f"faq-{index}")
        if answer["status"] == "answered":
            answered.append((item["faq"][0], answer["intent"]))
    assert len(answered) == len(CORPUS), {
        "answered": answered,
        "missing": [item["faq"][0] for item in CORPUS if item["faq"][0] not in {row[0] for row in answered}],
    }


def test_object_questions_keep_business_intent_and_failures(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    seed_corpus(api)
    api.seed_manual_point()
    cases = {
        "CSV 导入为什么需要先预检？": "knowledge",
        "恢复待确认会自动关闭预警吗？": "knowledge",
        "维修人员可以自行验收工单吗？": "knowledge",
        "这条预警为什么被触发": "event_reason",
        "B03-F2-CRACK01 为什么是红色": "event_reason",
        "B99-F9-CRACK01 阈值是什么意思": None,
    }
    intents = {question: _ask(api, question, f"route-{index}")["intent"] for index, question in enumerate(cases)}
    assert intents["CSV 导入为什么需要先预检？"] == "knowledge"
    assert intents["恢复待确认会自动关闭预警吗？"] == "knowledge"
    assert intents["维修人员可以自行验收工单吗？"] == "knowledge"
    assert intents["这条预警为什么被触发"] == "event_reason"
    assert intents["B03-F2-CRACK01 为什么是红色"] == "event_reason"
    missing = _ask(api, "B99-F9-CRACK01 阈值是什么意思", "route-missing")
    assert missing["status"] == "not_found"
    assert "0.82" not in json.dumps(intents)


def test_point_status_uses_current_rule_version_and_snapshot(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_red_event()
    answer = _ask(api, "B03-F2-CRACK01 现在怎么样", "rules-before")
    assert answer["snapshot"]["objects"]["pointId"]["rev"] == ids["point"]["rev"]
    assert "0.82" in json.dumps(answer["facts"])

    engine = create_engine(str(settings.database_url))
    with engine.begin() as db:
        current = db.execute(text("SELECT * FROM rules LIMIT 1"))
        columns = [item[1] for item in db.execute(text("PRAGMA table_info(rules)"))]
        raw = dict(zip(columns, current.one(), strict=True))
        db.execute(text("UPDATE rules SET enabled=0 WHERE dataset_id='demo-main'"))
        raw.update(
            id="review-next-disabled",
            version="V1.1",
            enabled=0,
            effective_from="2026-01-01T00:00:00+00:00",
        )
        db.execute(
            text(
                "INSERT INTO rules ("
                + ",".join(columns)
                + ") VALUES ("
                + ",".join(":" + name for name in columns)
                + ")"
            ),
            raw,
        )
    engine.dispose()
    disabled = _ask(api, "B03-F2-CRACK01 现在怎么样", "rules-disabled")
    assert "V0.9" not in json.dumps(disabled)
    assert disabled["snapshot"]["rules"] == []


def test_trial_parses_candidate_and_reuses_engine(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    api.seed_red_event()
    before = counts(str(settings.database_url), "events", "records", "audits")
    trial = _ask(api, "B03-F2-CRACK01 试算黄色阈值改为0.15毫米", "trial-yellow")
    assert trial["status"] == "answered"
    assert "黄 0.15" in trial["conclusion"]
    rows = trial["extras"]["simulation"]
    assert any(row["candidate"] != row["original"] for row in rows)
    after = counts(str(settings.database_url), "events", "records", "audits")
    assert after == before
    missing = _ask(api, "B03-F2-CRACK01 试算", "trial-missing")
    assert missing["status"] == "need_choice"
    assert "候选阈值" in missing["conclusion"]
