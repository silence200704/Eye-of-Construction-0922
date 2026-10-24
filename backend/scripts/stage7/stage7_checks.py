"""阶段 7 逐题核验的小工具。"""

from stage7_http_support import Api

# ruff: noqa: E501
"""阶段 7 逐题验收：固定数据库前置 + 真实 HTTP + 数据库快照。

运行前启动独立临时 API（18002）并初始化空的阶段 7 库。
脚本只写临时库；每题保存回答、对象 ID、关键事实与引用核验。
"""


def fact(answer: dict, label: str) -> str:
    return next((row["value"] for row in answer["facts"] if row["label"] == label), "")


def citation_valid(api: Api, row: dict) -> bool:
    try:
        doc = api.get(f"/knowledge/documents/{row['documentId']}")
    except AssertionError:
        return False
    chunk = next((item for item in doc["chunks"] if item["id"] == row["chunkId"]), None)
    if chunk is None or doc["version"] != row["version"] or not doc["enabled"]:
        return False
    lines = doc["content"].splitlines()
    excerpt = "\n".join(lines[row["lineStart"] - 1 : row["lineEnd"]]).strip()
    return chunk["text"] in excerpt and chunk["sha256"] == row["sha256"]


def check(name: str, ok: bool, detail: str = "") -> dict:
    return {"check": name, "passed": bool(ok), "detail": detail}


def basic(answer: dict, intent: str, status: str = "answered") -> list[dict]:
    return [
        check("intent", answer.get("intent") == intent, str(answer.get("intent"))),
        check("status", answer.get("status") == status, str(answer.get("status"))),
        check(
            "source_facts",
            answer["sources"]["facts"] == ("server_db" if status == "answered" else "none"),
            answer["sources"]["facts"],
        ),
    ]


def point_checks(answer: dict, point_id: str, value: str | None = None) -> list[dict]:
    checks = [
        check(
            "object_point",
            answer["objects"]["pointId"] == point_id,
            str(answer["objects"]["pointId"]),
        ),
        check("fact_point_label", bool(fact(answer, "测点")), fact(answer, "测点")),
    ]
    if value is not None:
        checks.append(
            check("fact_current", fact(answer, "当前读数") == value, fact(answer, "当前读数"))
        )
    return checks
