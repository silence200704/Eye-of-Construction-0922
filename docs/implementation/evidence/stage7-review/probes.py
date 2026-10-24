"""阶段 7 独立复核；只操作临时库，不改交付库或生产实现。"""

import ast
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[4]
sys.path[:0] = [str(ROOT / "backend/src"), str(ROOT / "backend/tests")]

from assistant.fixtures import AssistantApi
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from zhutong.app import create_app
from zhutong.bootstrap import initialize
from zhutong.core.settings import Settings

PREFIX = "/api/v1/datasets/demo-main"


def summary(answer):
    return {
        key: answer.get(key)
        for key in ("intent", "status", "conclusion", "objects", "facts", "extras")
    }


def ask(api, question, **changes):
    headers = api.headers(changes.pop("key", None))
    headers.update(changes.pop("headers", {}))
    response = api.client.post(
        PREFIX + "/assistant/query", headers=headers, json={"question": question, **changes}
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def counter(settings):
    engine = create_engine(str(settings.database_url))
    with engine.connect() as db:
        data = {
            name: db.execute(text("SELECT count(*) FROM " + name)).scalar_one()
            for name in (
                "assistant_turns",
                "media_frames",
                "media_comparisons",
                "audits",
                "operation_receipts",
            )
        }
    engine.dispose()
    return data


def writes(api, ids, settings):
    before = counter(settings)
    first = ask(api, "全校现在概况如何", key="review-same-key")
    second = ask(api, "全校现在概况如何", key="review-same-key")
    stale = ask(api, "全校现在概况如何", headers={"X-Dataset-Epoch": "999"})
    media = api.upload_photo(ids["point"]["id"], key="review-media")
    body = {"pointId": ids["point"]["id"], "mediaId": media["id"]}
    responses = [api.fpost("/media-sessions/frames", body, "review-frame-key") for _ in range(2)]
    frames = [response.json()["data"] for response in responses]
    comparison_body = {
        "pointId": ids["point"]["id"],
        "beforeId": frames[0]["id"],
        "afterId": frames[1]["id"],
        "result": {"changedRatio": 0.1},
    }
    comparisons = [
        api.fpost("/media-sessions/comparisons", comparison_body, "review-comparison-key")
        for _ in range(2)
    ]
    chosen = api.client.post(
        PREFIX + "/assistant/query",
        headers=api.headers(),
        json={
            "question": "B03-F2-CRACK01 现在怎么样",
            "context": {"pointId": ids["point"]["id"], "chosen": True},
        },
    )
    after = counter(settings)
    return {
        "before": before,
        "after": after,
        "sameAskTurn": first["turnId"] == second["turnId"],
        "sameFrame": frames[0]["id"] == frames[1]["id"],
        "staleEpochAccepted": bool(stale["turnId"]),
        "frameIds": [frame["id"] for frame in frames],
        "comparisonIds": [item.json()["data"]["id"] for item in comparisons],
        "webChosenPayloadStatus": chosen.status_code,
    }


def scope(api, ids):
    issue = api.report_issue(ids["manual"], submissionId="review-issue")["issue"]
    token = api.add_scoped_user("review-no-buildings", [], role="safety")
    headers = {"Authorization": "Bearer " + token}
    output = {"outOfScopeIssue": issue["id"]}
    for suffix in (
        "/media-sessions/frames",
        "/media-sessions/summary",
        "/media-sessions/comparisons",
    ):
        response = api.client.get(PREFIX + suffix, headers=headers)
        output[suffix] = {"status": response.status_code, "data": response.json().get("data")}
    output["caseSearch"] = summary(ask(api, "有没有类似裂缝案例", headers=headers)["answer"])
    return output


def objects(api, ids):
    current = ask(api, "B03-F2-CRACK01 现在怎么样")["answer"]
    followup = ask(api, "这条预警为什么被触发", context={"pointId": ids["point"]["id"]})["answer"]
    foreign = ask(api, "B99 的裂缝测点现在怎么样")["answer"]
    return {
        "current": summary(current),
        "followup": summary(followup),
        "explicitMissingBuilding": summary(foreign),
    }


def recovery_scope(api, ids, settings):
    token = api.add_scoped_user("review-revoked", [ids["building"]["id"]], role="safety")
    headers = {"Authorization": "Bearer " + token}
    original = ask(api, "B03-F2-CRACK01 现在怎么样", headers=headers)
    engine = create_engine(str(settings.database_url))
    with engine.begin() as db:
        db.execute(text("UPDATE users SET building_ids_json='[]' WHERE id='review-revoked'"))
    engine.dispose()
    session_id = original["sessionId"]
    response = api.client.get(PREFIX + "/assistant/sessions/" + session_id, headers=headers)
    fresh = ask(api, "B03-F2-CRACK01 现在怎么样", headers=headers)["answer"]
    return {
        "freshQuery": summary(fresh),
        "restoreStatus": response.status_code,
        "restoredAnswer": summary(response.json()["data"]["turns"][0]["answer"]),
    }


def epoch_restore(api, ids, settings):
    original = ask(api, "B03-F2-CRACK01 现在怎么样")
    engine = create_engine(str(settings.database_url))
    with engine.begin() as db:
        db.execute(text("UPDATE datasets SET epoch=epoch+1 WHERE id='demo-main'"))
    engine.dispose()
    response = api.client.get(
        PREFIX + "/assistant/sessions/" + original["sessionId"], headers=api.auth()
    )
    retried = ask(api, "全校现在概况如何", sessionId=original["sessionId"])
    return {
        "restoreStatusAfterEpochChange": response.status_code,
        "oldSessionReused": original["sessionId"] == retried["sessionId"],
    }


def rules(api, ids, settings):
    before = ask(api, "B03-F2-CRACK01 现在怎么样")["answer"]
    engine = create_engine(str(settings.database_url))
    with engine.begin() as db:
        original_assessment = db.execute(
            text("SELECT assessment FROM records LIMIT 1")
        ).scalar_one()
        db.execute(text("UPDATE rules SET version='V0.9',enabled=1 WHERE dataset_id='demo-main'"))
        columns = [item[1] for item in db.execute(text("PRAGMA table_info(rules)"))]
        raw = dict(zip(columns, db.execute(text("SELECT * FROM rules LIMIT 1")).one(), strict=True))
        raw.update(id="review-new-disabled-rule", version="V1.0", enabled=0)
        db.execute(
            text(
                "INSERT INTO rules ("
                + ",".join(columns)
                + ") VALUES ("
                + ",".join(":" + c for c in columns)
                + ")"
            ),
            raw,
        )
    engine.dispose()
    trial = ask(
        api, "B03-F2-CRACK01 试算黄色阈值改为0.15毫米", context={"pointId": ids["point"]["id"]}
    )["answer"]
    current = ask(api, "B03-F2-CRACK01 现在怎么样")["answer"]
    return {
        "before": summary(before),
        "trialDisabledRules": summary(trial),
        "recordAssessment": json.loads(original_assessment),
        "newDisabledRuleAnswer": summary(current),
    }


def structure():
    problems = []
    base = ROOT / "backend"
    paths = [base / "src/zhutong/operations/assistant", base / "tests/assistant"]
    paths.extend([path for path in (base / "scripts").glob("stage7_*.py")])
    for entry in paths:
        files = entry.rglob("*.py") if entry.is_dir() else [entry]
        if entry.is_dir() and len(list(entry.glob("*.py"))) > 8:
            problems.append(
                {"path": str(entry.relative_to(ROOT)), "directFiles": len(list(entry.glob("*.py")))}
            )
        for path in files:
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                count = len(node.args.args) + len(node.args.kwonlyargs) + len(node.args.posonlyargs)
                length = node.end_lineno - node.lineno + 1
                if count > 5 or length > 80:
                    problems.append(
                        {
                            "path": str(path.relative_to(ROOT)),
                            "name": node.name,
                            "line": node.lineno,
                            "parameters": count,
                            "lines": length,
                        }
                    )
    return problems


def canonical_faqs(api):
    corpus = json.loads(
        (ROOT / "backend/resources/knowledge/corpus.json").read_text(encoding="utf-8")
    )
    results = []
    for item in corpus:
        doc = api.knowledge_doc(item["title"], item["content"], item["sourcePath"])
        api.knowledge_faq(doc["chunks"][0]["id"], item["faq"])
    for item in corpus:
        question = item["faq"][0]
        search = api.client.post(
            PREFIX + "/knowledge/search", headers=api.headers(), json={"query": question, "topK": 3}
        )
        assert search.status_code == 200, search.text
        direct = search.json()["data"]
        answer = ask(api, question, context={})["answer"]
        results.append(
            {
                "question": question,
                "directDecision": direct["decision"],
                "assistant": summary(answer),
            }
        )
    return {
        "method": "canonical corpus FAQ, keyword/FAQ fallback; no local embedding model in this temporary DB",
        "total": len(results),
        "directAnswers": sum(row["directDecision"] == "answer" for row in results),
        "assistantAnswered": sum(row["assistant"]["status"] == "answered" for row in results),
        "results": results,
    }


def main():
    with TemporaryDirectory(prefix="zhutong-stage7-review-") as temporary:
        runtime = Path(temporary)
        settings = Settings(
            runtime_dir=runtime, database_url=f"sqlite:///{(runtime / 'review.sqlite').as_posix()}"
        )
        initialize(settings)
        with TestClient(create_app(settings)) as client:
            api = AssistantApi(client, str(settings.database_url))
            ids = api.seed_manual_point()
            api.add_record(ids["point"]["id"], 0.82, minutes=-15)
            output = {
                "method": "isolated ASGI HTTP boundary (TestClient), not production",
                "writes": writes(api, ids, settings),
                "scope": scope(api, ids),
                "objects": objects(api, ids),
                "revokedScope": recovery_scope(api, ids, settings),
                "rules": rules(api, ids, settings),
                "canonicalFaqs": canonical_faqs(api),
                "epoch": epoch_restore(api, ids, settings),
                "structure": structure(),
            }
    target = Path(__file__).with_name("results.json")
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(output, ensure_ascii=True))


if __name__ == "__main__":
    main()
