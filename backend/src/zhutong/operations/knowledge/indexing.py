"""构建完整候选版本后原子发布；失败保留前一个版本和可见错误。"""

from pathlib import Path

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.models.knowledge import KnowledgeIndex, KnowledgeState, KnowledgeVector
from ...domain.knowledge.model import ModelUnavailable, get_encoder
from ...domain.knowledge.text import digest
from ..datasets.core.workspace import AuditEntry, Workspace, now_iso, uid, write_audit
from .corpus import corpus_hash, current_chunks, maintain


def state_of(session: Session) -> KnowledgeState:
    state = session.get(KnowledgeState, 1)
    if state is None:
        state = KnowledgeState(id=1, active_index_id=None, last_error="")
        session.add(state)
        session.flush()
    return state


def load_vectors(session: Session, index: KnowledgeIndex) -> tuple[list[str], np.ndarray]:
    rows = session.scalars(
        select(KnowledgeVector)
        .where(KnowledgeVector.index_id == index.id)
        .order_by(KnowledgeVector.chunk_id)
    ).all()
    if len(rows) != index.vector_count:
        raise ModelUnavailable("向量条目缺失，索引无效")
    vectors = []
    for row in rows:
        if len(row.embedding) != index.dimension * 4 or digest(row.embedding) != row.sha256:
            raise ModelUnavailable("向量维度或哈希不一致，索引损坏")
        vector = np.frombuffer(row.embedding, dtype="<f4")
        if not np.isfinite(vector).all() or abs(float(np.linalg.norm(vector)) - 1) > 0.01:
            raise ModelUnavailable("向量数值无效")
        vectors.append(vector)
    return [r.chunk_id for r in rows], np.asarray(vectors, dtype="<f4").reshape(-1, index.dimension)


def usable(session: Session, runtime: Path) -> tuple:
    encoder = get_encoder(runtime)
    state = session.get(KnowledgeState, 1)
    index = (
        session.get(KnowledgeIndex, state.active_index_id)
        if state and state.active_index_id
        else None
    )
    if index is None:
        raise ModelUnavailable("尚未发布本地向量索引")
    if (index.model_id, index.model_revision, index.manifest_hash, index.dimension) != (
        encoder.model_id,
        encoder.revision,
        encoder.fingerprint,
        encoder.dimension,
    ):
        raise ModelUnavailable("模型或维度已改变，需要重建索引")
    if index.corpus_hash != corpus_hash(current_chunks(session)):
        raise ModelUnavailable("当前知识已变更，需要重建索引")
    ids, vectors = load_vectors(session, index)
    if set(ids) != {c.id for c, _ in current_chunks(session)}:
        raise ModelUnavailable("索引条目与当前原文不一致")
    return encoder, index, ids, vectors


def status(session: Session, runtime: Path) -> dict:
    state = session.get(KnowledgeState, 1)
    data = {
        "activeIndexId": state.active_index_id if state else None,
        "lastError": state.last_error if state else "",
        "scope": "global",
        "chunkCount": len(current_chunks(session)),
    }
    try:
        encoder, index, _, _ = usable(session, runtime)
        return {
            **data,
            "mode": "hybrid",
            "modelId": encoder.model_id,
            "dimension": encoder.dimension,
            "indexVersion": index.id,
            "degradedReason": "",
        }
    except ModelUnavailable as error:
        return {**data, "mode": "keyword", "degradedReason": str(error)}


def _build(session: Session, runtime: Path) -> KnowledgeIndex:
    encoder = get_encoder(runtime)
    chunks = current_chunks(session)
    index = KnowledgeIndex(
        id=uid("index"),
        model_id=encoder.model_id,
        model_revision=encoder.revision,
        manifest_hash=encoder.fingerprint,
        dimension=encoder.dimension,
        corpus_hash=corpus_hash(chunks),
        vector_count=len(chunks),
        created_at=now_iso(),
    )
    session.add(index)
    session.flush()
    for start in range(0, len(chunks), 16):
        batch = chunks[start : start + 16]
        vectors = encoder.encode(
            [doc.title + "\n" + chunk.heading + "\n" + chunk.text for chunk, doc in batch]
        )
        if vectors.shape != (len(batch), encoder.dimension):
            raise ModelUnavailable("构建输出维度错误")
        for (chunk, _), vector in zip(batch, vectors, strict=True):
            blob = np.asarray(vector, dtype="<f4").tobytes()
            session.add(
                KnowledgeVector(
                    index_id=index.id, chunk_id=chunk.id, embedding=blob, sha256=digest(blob)
                )
            )
    session.flush()
    load_vectors(session, index)
    return index


def rebuild(session: Session, workspace: Workspace, runtime: Path) -> dict:
    maintain(workspace)
    state = state_of(session)
    try:
        with session.begin_nested():
            index = _build(session, runtime)
            state.active_index_id = index.id
            state.last_error = ""
            session.flush()
        built = True
    except (ModelUnavailable, OSError, ValueError) as error:
        state.last_error = str(error)
        built = False
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id="knowledge-index",
            object_label="本地知识索引",
            summary="索引发布" if built else "索引构建失败，保留原版本",
            reason=state.last_error,
        ),
    )
    return {"built": built, "activeIndexId": state.active_index_id, "error": state.last_error}
