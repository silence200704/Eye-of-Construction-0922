# ruff: noqa: E501, E402
"""阶段 7 知识两路复验：20 条标准 FAQ 与冻结 60 题分别走检索接口和助手入口。"""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from uuid import uuid4

SCRIPTS = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from stage7_http_support import Api

ROOT = SCRIPTS.parents[1]
FAQS = ROOT.parent / "docs/implementation/evidence/stage6-knowledge/retrieval/faqs.json"
OUT = (
    ROOT.parent / "docs/implementation/evidence/stage7-assistant/verification/knowledge-paths.json"
)


def _search(api: Api, query: str) -> dict:
    return api.post("/knowledge/search", {"query": query, "topK": 3}, f"k-search-{uuid4().hex}")


def _assistant(api: Api, query: str) -> dict:
    reply = api.ask(query, key=f"k-ask-{uuid4().hex}")
    return reply["answer"]


def _sources(response: dict) -> list[str]:
    return [row.get("sourcePath", "") for row in response.get("candidates", [])]


def faq_row(api: Api, item: dict, index: int) -> dict:
    search = _search(api, item["question"])
    answer = _assistant(api, item["question"])
    citations = [row.get("sourcePath", "") for row in answer.get("citations", [])]
    search_ok = search.get("decision") == "answer" and _sources(search)[:1] == [
        item["expectedSource"]
    ]
    ask_ok = (
        answer.get("intent") == "knowledge"
        and answer.get("status") == "answered"
        and answer.get("knowledge", {}).get("decision") == "answer"
        and item["expectedSource"] in citations
    )
    return {
        "id": f"faq-{index}",
        "question": item["question"],
        "expectedSource": item["expectedSource"],
        "search": {
            "decision": search.get("decision"),
            "sources": _sources(search),
            "passed": search_ok,
        },
        "assistant": {
            "intent": answer.get("intent"),
            "status": answer.get("status"),
            "decision": answer.get("knowledge", {}).get("decision"),
            "citations": citations,
            "passed": ask_ok,
            "conclusion": answer.get("conclusion", "")[:160],
        },
        "passed": search_ok and ask_ok,
    }


def acceptance_row(api: Api, item: dict) -> dict:
    expected = item["expectedDecision"]
    search = _search(api, item["query"])
    answer = _assistant(api, item["query"])
    decision = answer.get("knowledge", {}).get("decision")
    citations = [row.get("sourcePath", "") for row in answer.get("citations", [])]
    if expected == "answer":
        search_ok = (
            search.get("decision") == "answer" and item["expectedSource"] in _sources(search)[:3]
        )
        ask_ok = (
            answer.get("status") == "answered"
            and decision == "answer"
            and item["expectedSource"] in citations
        )
    elif expected == "clarify":
        search_ok = search.get("decision") == "clarify"
        ask_ok = answer.get("status") == "clarify" and decision == "clarify"
    else:
        search_ok = search.get("decision") == "no_basis"
        ask_ok = answer.get("status") == "unsupported" and decision == "no_basis"
    return {
        "id": item["id"],
        "kind": item["kind"],
        "query": item["query"],
        "expectedDecision": expected,
        "expectedSource": item.get("expectedSource"),
        "search": {
            "decision": search.get("decision"),
            "sources": _sources(search),
            "passed": search_ok,
        },
        "assistant": {
            "intent": answer.get("intent"),
            "status": answer.get("status"),
            "decision": decision,
            "citations": citations,
            "passed": ask_ok,
            "conclusion": answer.get("conclusion", "")[:160],
        },
        "passed": search_ok and ask_ok,
    }


def summarize(rows: list[dict], key: str = "passed") -> dict:
    return {
        "total": len(rows),
        "passed": sum(row[key] for row in rows),
        "searchPassed": sum(row["search"]["passed"] for row in rows),
        "assistantPassed": sum(row["assistant"]["passed"] for row in rows),
        "failed": [row["id"] for row in rows if not row[key]],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:18002/api/v1/")
    parser.add_argument("--epoch", type=int, default=2)
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    api = Api(args.url)
    api.epoch = args.epoch
    try:
        faqs = json.loads(FAQS.read_text(encoding="utf-8"))["results"]
        acceptance = json.loads(
            (ROOT / "resources/knowledge/acceptance.json").read_text(encoding="utf-8")
        )["questions"]
        faq_rows = [faq_row(api, item, index + 1) for index, item in enumerate(faqs)]
        acc_rows = [acceptance_row(api, item) for item in acceptance]
        by_kind = Counter(row["kind"] for row in acc_rows)
        payload = {
            "base": args.url,
            "faq": summarize(faq_rows),
            "acceptance": summarize(acc_rows),
            "acceptanceByKind": {
                kind: {
                    "total": count,
                    "passed": sum(1 for row in acc_rows if row["kind"] == kind and row["passed"]),
                }
                for kind, count in by_kind.items()
            },
            "faqResults": faq_rows,
            "acceptanceResults": acc_rows,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {
                    "faq": payload["faq"],
                    "acceptance": payload["acceptance"],
                    "acceptanceByKind": payload["acceptanceByKind"],
                },
                ensure_ascii=False,
            )
        )
        return 0
    finally:
        api.close()


if __name__ == "__main__":
    sys.exit(main())
