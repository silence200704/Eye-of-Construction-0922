"""FAQ 只绑定已有原文；同义词可维护，但不执行用户文本。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.knowledge import KnowledgeChunk, KnowledgeFAQ, KnowledgeSynonym
from ...domain.knowledge.text import normalized
from ..datasets.core.workspace import AuditEntry, Workspace, require_revision, uid, write_audit
from .corpus import maintain


def output(row) -> dict:
    data = {"id": row.id, "enabled": row.enabled, "rev": row.revision}
    return (
        {**data, "chunkId": row.chunk_id, "questions": row.questions}
        if isinstance(row, KnowledgeFAQ)
        else {**data, "canonical": row.canonical, "aliases": row.aliases}
    )


def listing(session: Session, kind: str) -> list[dict]:
    model = KnowledgeFAQ if kind == "faqs" else KnowledgeSynonym
    return [output(row) for row in session.scalars(select(model))]


def save(session: Session, workspace: Workspace, kind: str, payload: dict) -> dict:
    maintain(workspace)
    model = KnowledgeFAQ if kind == "faqs" else KnowledgeSynonym
    row_id = payload.get("id")
    row = session.get(model, row_id) if row_id else None
    if row_id and row is None:
        raise AppError("NOT_FOUND", "词条不存在", 404)
    if row:
        require_revision(payload.get("expectedRev"), row)
    if kind == "faqs":
        if session.get(KnowledgeChunk, payload["chunkId"]) is None:
            raise AppError("NOT_FOUND", "FAQ 依据块不存在", 404)
        fields = {"chunk_id": payload["chunkId"], "questions": payload["questions"]}
    else:
        values = {normalized(payload["canonical"]), *(normalized(v) for v in payload["aliases"])}
        for other in session.scalars(select(KnowledgeSynonym)):
            reserved = {normalized(other.canonical), *(normalized(v) for v in other.aliases)}
            if other.id != row_id and other.enabled and values & reserved:
                raise AppError("VALIDATION_FAILED", "同义词与已有业务术语冲突", 422)
        fields = {"canonical": payload["canonical"], "aliases": payload["aliases"]}
    if row is None:
        row = model(id=uid(kind), revision=1, enabled=payload.get("enabled", True), **fields)
        session.add(row)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
        row.enabled = payload.get("enabled", True)
        row.revision += 1
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=row.id,
            object_label=kind,
            summary="维护知识词条",
            reason="原文绑定/术语规范化",
        ),
    )
    session.flush()
    return output(row)
