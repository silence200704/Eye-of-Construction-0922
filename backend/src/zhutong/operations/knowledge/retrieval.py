"""FAQ、关键词与本地向量混合召回；输出引用，不生成业务事实。"""

import re
import time
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.models.knowledge import KnowledgeFAQ, KnowledgeSynonym
from ...domain.knowledge.model import ModelUnavailable
from ...domain.knowledge.text import normalized, terms
from ..datasets.core.workspace import Workspace
from .corpus import current_chunks
from .indexing import usable


def normalize_query(session: Session, query: str) -> str:
    text = normalized(query)
    replacements = []
    for row in session.scalars(select(KnowledgeSynonym).where(KnowledgeSynonym.enabled.is_(True))):
        replacements.extend((normalized(alias), normalized(row.canonical)) for alias in row.aliases)
    for alias, canonical in sorted(replacements, key=lambda item: len(item[0]), reverse=True):
        if alias:
            text = text.replace(alias, canonical)
    return text


def _vector_scores(session: Session, runtime: Path, query: str) -> tuple[dict, str, str]:
    try:
        encoder, index, ids, vectors = usable(session, runtime)
        vector = encoder.encode([query], query=True)[0]
        return dict(zip(ids, (vectors @ vector).tolist(), strict=True)), index.id, ""
    except ModelUnavailable as error:
        return {}, "", str(error)


def _faq_matches(session: Session, query: str) -> set[str]:
    hits = set()
    for row in session.scalars(select(KnowledgeFAQ).where(KnowledgeFAQ.enabled.is_(True))):
        if any(normalize_query(session, question) == query for question in row.questions):
            hits.add(row.chunk_id)
    return hits


def _candidates(session: Session, workspace: Workspace, query: str, vectors: dict) -> list[dict]:
    faqs = _faq_matches(session, query)
    query_terms = terms(query)
    rows = []
    for chunk, doc in current_chunks(session, workspace.actor.role):
        haystack = normalize_query(session, doc.title + chunk.heading + chunk.text)
        matched = query_terms & terms(haystack)
        keyword = len(matched) / max(1, len(query_terms))
        semantic = vectors.get(chunk.id, 0)
        methods = ([] if not matched else ["keyword"]) + (
            [] if chunk.id not in vectors else ["vector"]
        )
        if chunk.id in faqs:
            methods.insert(0, "faq")
        relevance = 1.0 if chunk.id in faqs else 0.65 * max(semantic, 0) + 0.35 * keyword
        rows.append(
            {
                "documentId": doc.id,
                "chunkId": chunk.id,
                "title": doc.title,
                "heading": chunk.heading,
                "text": chunk.text,
                "version": chunk.version,
                "sourcePath": doc.source_path,
                "sourceKind": doc.source_kind,
                "lineStart": chunk.line_start,
                "lineEnd": chunk.line_end,
                "sha256": chunk.sha256,
                "methods": methods,
                "relevance": round(relevance, 5),
                "keywordScore": round(keyword, 5),
                "vectorScore": round(float(semantic), 5),
                "matchedTerms": len(matched),
            }
        )
    return sorted(rows, key=lambda row: (-row["relevance"], row["chunkId"]))


def _decision(query: str, rows: list[dict]) -> tuple[str, str]:
    if not rows:
        return "no_basis", "当前启用知识中没有充分依据"
    if "faq" in rows[0]["methods"]:
        return "answer", "标准 FAQ 命中；请核对原文引用"
    if re.search(
        r"(当前|现在|今天|最新).*(多少|几个|状态|数量)|有多少.*(工单|事件|问题)|WO[-\d]",
        query,
        re.I,
    ):
        return "no_basis", "这是动态业务事实，请通过业务页面查询，不能用静态知识推测"
    objects = re.findall(
        r"预警|事件|工单|问题|巡检|点检|保养|测点|设备|基准|规则|知识|照片|csv|通知", query
    )
    vague = re.search(r"这个|那个|它|这些|那里", query)
    generic = re.sub(r"怎么|如何|请问|一下|可以|需要|的|了|吗|呢|啊|呀", "", query)
    if vague or (len(generic) <= 4 and len(set(objects)) != 1):
        return "clarify", "请说明具体对象：预警事件、维修工单、巡检任务还是问题复查？"
    top = rows[0]
    if top["matchedTerms"] < 2 and top["vectorScore"] < 0.74:
        return "no_basis", "相关度不足，当前知识没有充分依据"
    if len(rows) > 1 and top["relevance"] - rows[1]["relevance"] < 0.025 and not objects:
        return "clarify", "多个知识主题接近，请补充业务对象或要执行的动作"
    return "answer", "根据当前启用知识返回原文；相关度不是可信概率"


def search(session: Session, workspace: Workspace, runtime: Path, payload: dict) -> dict:
    started = time.perf_counter()
    query = normalize_query(session, payload["query"])
    scores, index_id, error = _vector_scores(session, runtime, query)
    rows = _candidates(session, workspace, query, scores)
    decision, reason = _decision(query, rows)
    candidates = rows[: payload.get("topK", 3)] if decision != "no_basis" else []
    return {
        "decision": decision,
        "reason": reason,
        "candidates": candidates,
        "mode": "keyword" if error else "hybrid",
        "degradedReason": error,
        "indexVersion": index_id or None,
        "elapsedMs": round((time.perf_counter() - started) * 1000, 2),
        "answer": candidates[0]["text"] if decision == "answer" and candidates else "",
        "scope": "global",
    }
