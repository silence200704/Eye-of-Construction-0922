"""读取冻结标注，保存逐题真实响应、引用核验和汇总。"""

import argparse
import hashlib
import json
import statistics
from pathlib import Path

from client import Client

ROOT = Path(__file__).resolve().parents[2]


def valid_citation(row: dict, documents: dict) -> bool:
    doc = documents.get(row["documentId"])
    if not doc or not doc["enabled"] or doc["version"] != row["version"]:
        return False
    lines = doc["content"].splitlines()
    excerpt = "\n".join(lines[row["lineStart"] - 1 : row["lineEnd"]]).strip()
    return (
        row["text"] in excerpt
        and row["sourcePath"] == doc["sourcePath"]
        and hashlib.sha256(row["text"].encode()).hexdigest() == row["sha256"]
    )


def evaluate(client: Client, source: Path) -> dict:
    raw = source.read_bytes()
    questions = json.loads(raw)
    if isinstance(questions, dict):
        questions = questions["questions"]
    documents = {doc["id"]: doc for doc in client.get("/documents")}
    results = []
    for question in questions:
        response = client.post("/search", {"query": question["query"], "topK": 3})
        expected = question.get("expectedDecision", "answer")
        hit = any(
            row["sourcePath"] == question.get("expectedSource")
            and row["heading"] == question.get("expectedHeading")
            for row in response["candidates"]
        )
        citations = all(valid_citation(row, documents) for row in response["candidates"])
        passed = (
            response["decision"] == expected
            and citations
            and (hit if expected == "answer" else not response["answer"])
        )
        results.append(
            {
                **question,
                "passed": passed,
                "top3Hit": hit,
                "citationsValid": citations,
                "response": response,
            }
        )
    timings = [row["response"]["elapsedMs"] for row in results]
    return {
        "dataset": source.name,
        "datasetSha256": hashlib.sha256(raw).hexdigest(),
        "total": len(results),
        "passed": sum(row["passed"] for row in results),
        "answerTop3": sum(
            row["passed"] for row in results if row.get("expectedDecision", "answer") == "answer"
        ),
        "candidateTop3": sum(row["top3Hit"] for row in results),
        "clarifyPassed": sum(
            row["passed"] for row in results if row.get("expectedDecision") == "clarify"
        ),
        "noBasisPassed": sum(
            row["passed"] for row in results if row.get("expectedDecision") == "no_basis"
        ),
        "citationsValid": all(row["citationsValid"] for row in results),
        "medianMs": statistics.median(timings),
        "maxMs": max(timings),
        "results": results,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:18000")
    parser.add_argument("--dataset", choices=["development", "acceptance"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    client = Client(args.url)
    try:
        result = evaluate(client, ROOT / f"resources/knowledge/{args.dataset}.json")
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {key: value for key, value in result.items() if key != "results"},
                ensure_ascii=False,
            )
        )
    finally:
        client.close()
