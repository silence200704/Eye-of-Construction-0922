"""知识题与业务回答上的知识引用；与业务事实严格分列。"""

import re
from pathlib import Path

from sqlalchemy.orm import Session

from ...datasets.core.workspace import Workspace
from ...knowledge import retrieval
from . import facts

KNOWLEDGE_ATTACH_INTENTS = {"point_status", "event_reason", "issue_status", "reading_recovery"}


def _knowledge(session: Session, workspace: Workspace, runtime: Path, question: str) -> dict | None:
    try:
        return retrieval.search(session, workspace, runtime, {"query": question, "topK": 2})
    except Exception:  # noqa: BLE001  检索降级不能挡住业务事实回答
        return None


def _plain(text: str) -> str:
    """知识原文转成可读结论：去掉 Markdown 标题井号，保留段落。"""
    lines = [re.sub(r"^#{1,6}\s*", "", line).strip() for line in text.splitlines()]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def _knowledge_meta(knowledge: dict | None) -> dict:
    if knowledge is None:
        return {"decision": "unavailable", "mode": "none", "indexVersion": None}
    meta = {
        "decision": knowledge["decision"],
        "mode": knowledge["mode"],
        "indexVersion": knowledge.get("indexVersion"),
        "reason": knowledge.get("reason", ""),
    }
    if knowledge.get("degradedReason"):
        meta["degradedReason"] = knowledge["degradedReason"]
    if knowledge["decision"] == "answer" and knowledge.get("answer"):
        meta["excerpt"] = _plain(knowledge["answer"])[:280]
    return meta


def _citations(knowledge: dict | None) -> list[dict]:
    if knowledge is None:
        return []
    return [
        {
            "documentId": row["documentId"],
            "chunkId": row["chunkId"],
            "title": row["title"],
            "version": row["version"],
            "sha256": row["sha256"],
            "lineStart": row["lineStart"],
            "lineEnd": row["lineEnd"],
            "sourcePath": row["sourcePath"],
            "methods": row["methods"],
        }
        for row in knowledge.get("candidates", [])
    ]


def _knowledge_answer(knowledge: dict | None) -> dict:
    """知识题只回答知识库原文；不借用业务对象，也不生成业务事实。"""
    if knowledge is None:
        return {
            "intent": "knowledge",
            "status": "unsupported",
            "conclusion": "本地知识检索当前不可用，未生成解释；业务事实仍可在对应页面查询。",
            "facts": [],
            "evidence": [],
            "citations": [],
            "knowledge": _knowledge_meta(None),
            "gaps": ["retrieval_unavailable"],
            "sources": {
                "facts": "none",
                "knowledge": "unavailable",
                "queriedAt": facts.queried_at(),
            },
            "dataNotes": ["知识检索失败不影响业务事实页面；不要据本回答推测现场状态。"],
        }
    decision = knowledge["decision"]
    if decision == "answer":
        return {
            "intent": "knowledge",
            "status": "answered",
            "conclusion": _plain(knowledge.get("answer") or ""),
            "facts": [],
            "evidence": [],
            "citations": _citations(knowledge),
            "knowledge": _knowledge_meta(knowledge),
            "gaps": [],
            "sources": {"facts": "none", "knowledge": "local_kb", "queriedAt": facts.queried_at()},
            "dataNotes": ["结论来自本地知识库原文，不是现场实时数据；引用可查看原文核对。"],
        }
    if decision == "clarify":
        return {
            "intent": "knowledge",
            "status": "clarify",
            "conclusion": (
                f"{knowledge.get('reason', '多个知识主题接近')}；请补充要问的对象或动作，"
                "例如「预警分级怎么判定」「工单验收要看哪些材料」。"
            ),
            "facts": [],
            "evidence": [],
            "citations": [],
            "knowledge": _knowledge_meta(knowledge),
            "candidates": _citations(knowledge),
            "gaps": ["knowledge_clarify"],
            "sources": {"facts": "none", "knowledge": "local_kb", "queriedAt": facts.queried_at()},
            "dataNotes": ["澄清问题不生成结论；引用候选可展开核对，但尚未选定依据。"],
        }
    return {
        "intent": "knowledge",
        "status": "unsupported",
        "conclusion": (
            "当前本地知识库没有足够依据回答这个问题，也未生成业务事实；"
            "可以换一种问法，或在知识库补充依据。"
        ),
        "facts": [],
        "evidence": [],
        "citations": [],
        "knowledge": _knowledge_meta(knowledge),
        "gaps": ["no_basis"],
        "sources": {"facts": "none", "knowledge": "no_basis", "queriedAt": facts.queried_at()},
        "dataNotes": ["没有依据时不引用、不推测；动态数量与状态请到业务页面查询。"],
    }


KNOWLEDGE_ATTACH_INTENTS = {"point_status", "event_reason", "issue_status", "reading_recovery"}


def _attach_knowledge(answer: dict, knowledge: dict | None, intent: str) -> dict:
    if (
        intent not in KNOWLEDGE_ATTACH_INTENTS
        or knowledge is None
        or knowledge["decision"] != "answer"
        or not knowledge.get("candidates")
    ):
        return answer
    answer["citations"] = _citations(knowledge)
    answer["knowledge"] = _knowledge_meta(knowledge)
    answer["sources"]["knowledge"] = "local_kb"
    answer.setdefault("dataNotes", []).append(
        "知识引用来自本地知识库，业务事实仍以服务端数据库为准。"
    )
    return answer
