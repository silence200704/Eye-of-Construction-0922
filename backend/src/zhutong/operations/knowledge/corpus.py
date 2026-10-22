"""知识可见性及当前版本集合：旧块永远不作为当前依据。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.knowledge import KnowledgeChunk, KnowledgeDocument
from ...domain.knowledge.text import digest
from ..datasets.core.workspace import Workspace, require_role


def maintain(workspace: Workspace) -> None:
    require_role(workspace, {"safety"}, "知识维护")
    if workspace.actor.building_ids is not None:
        raise AppError("SCOPE_FORBIDDEN", "通用知识维护需要全校范围身份", 403)


def current_chunks(session: Session, actor_role: str | None = None) -> list[tuple]:
    rows = session.execute(
        select(KnowledgeChunk, KnowledgeDocument)
        .join(KnowledgeDocument, KnowledgeChunk.document_id == KnowledgeDocument.id)
        .where(
            KnowledgeDocument.enabled.is_(True),
            KnowledgeChunk.version == KnowledgeDocument.current_version,
        )
        .order_by(KnowledgeChunk.id)
    ).all()
    return [(chunk, doc) for chunk, doc in rows if actor_role is None or actor_role in doc.roles]


def corpus_hash(rows: list[tuple]) -> str:
    return digest("|".join(f"{chunk.id}:{chunk.sha256}" for chunk, _ in rows))


def doc_of(session: Session, doc_id: str) -> KnowledgeDocument:
    doc = session.get(KnowledgeDocument, doc_id)
    if doc is None:
        raise AppError("NOT_FOUND", "知识文档不存在", 404)
    return doc


def chunk_out(chunk: KnowledgeChunk) -> dict:
    return {
        "id": chunk.id,
        "heading": chunk.heading,
        "text": chunk.text,
        "lineStart": chunk.line_start,
        "lineEnd": chunk.line_end,
        "sha256": chunk.sha256,
    }
