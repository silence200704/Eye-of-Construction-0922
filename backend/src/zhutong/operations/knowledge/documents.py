"""文档维护：追加不可变版本，引用原文行；不读取任意本机 sourcePath。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.knowledge import KnowledgeChunk, KnowledgeDocument, KnowledgeVersion
from ...domain.knowledge.text import digest, split_content
from ..datasets.core.workspace import (
    AuditEntry,
    Workspace,
    now_iso,
    require_revision,
    uid,
    write_audit,
)
from .corpus import chunk_out, doc_of, maintain


def detail(session: Session, workspace: Workspace, doc_id: str) -> dict:
    doc = doc_of(session, doc_id)
    if workspace.actor.role not in doc.roles and workspace.actor.role != "safety":
        raise AppError("SCOPE_FORBIDDEN", "文档不适用于当前身份", 403)
    version = session.get(KnowledgeVersion, (doc.id, doc.current_version))
    chunks = session.scalars(
        select(KnowledgeChunk)
        .where(KnowledgeChunk.document_id == doc.id, KnowledgeChunk.version == doc.current_version)
        .order_by(KnowledgeChunk.line_start)
    )
    return {
        "id": doc.id,
        "title": doc.title,
        "sourcePath": doc.source_path,
        "sourceKind": doc.source_kind,
        "version": doc.current_version,
        "enabled": doc.enabled,
        "roles": doc.roles,
        "rev": doc.revision,
        "updatedAt": doc.updated_at,
        "content": version.content,
        "sha256": version.sha256,
        "chunks": [chunk_out(row) for row in chunks],
        "versions": [
            {"version": v.version, "sha256": v.sha256, "createdAt": v.created_at}
            for v in session.scalars(
                select(KnowledgeVersion).where(KnowledgeVersion.document_id == doc.id)
            )
        ],
    }


def list_documents(session: Session, workspace: Workspace) -> list[dict]:
    docs = session.scalars(select(KnowledgeDocument).order_by(KnowledgeDocument.updated_at.desc()))
    return [
        detail(session, workspace, doc.id)
        for doc in docs
        if workspace.actor.role == "safety" or workspace.actor.role in doc.roles
    ]


def _append(session: Session, workspace: Workspace, doc: KnowledgeDocument, content: str) -> None:
    content = content.replace("\r\n", "\n").strip()
    if not content:
        raise AppError("VALIDATION_FAILED", "知识原文不能为空", 422)
    session.flush()
    version = KnowledgeVersion(
        document_id=doc.id,
        version=doc.current_version,
        content=content,
        sha256=digest(content),
        created_at=doc.updated_at,
        created_by=workspace.actor.id,
    )
    session.add(version)
    session.flush()
    for index, item in enumerate(split_content(content, doc.title)):
        session.add(
            KnowledgeChunk(
                id=f"{doc.id}:v{doc.current_version}:{index}",
                document_id=doc.id,
                version=doc.current_version,
                **item,
            )
        )
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=doc.id,
            object_label=doc.title,
            summary=f"知识文档版本 {doc.current_version}",
            reason=version.sha256,
        ),
    )
    session.flush()


def create(session: Session, workspace: Workspace, payload: dict) -> dict:
    maintain(workspace)
    doc = KnowledgeDocument(
        id=uid("knowledge"),
        title=payload["title"].strip(),
        source_path=payload["sourcePath"].strip(),
        source_kind=payload["sourceKind"],
        roles=payload["roles"],
        current_version=1,
        revision=1,
        enabled=True,
        updated_at=now_iso(),
    )
    session.add(doc)
    _append(session, workspace, doc, payload["content"])
    return detail(session, workspace, doc.id)


def version(session: Session, workspace: Workspace, doc_id: str, payload: dict) -> dict:
    maintain(workspace)
    doc = doc_of(session, doc_id)
    require_revision(payload["expectedRev"], doc)
    doc.current_version += 1
    doc.revision += 1
    doc.updated_at = now_iso()
    if payload.get("title"):
        doc.title = payload["title"].strip()
    if payload.get("roles") is not None:
        doc.roles = payload["roles"]
    _append(session, workspace, doc, payload["content"])
    return detail(session, workspace, doc.id)


def enabled(session: Session, workspace: Workspace, doc_id: str, payload: dict) -> dict:
    maintain(workspace)
    doc = doc_of(session, doc_id)
    require_revision(payload["expectedRev"], doc)
    doc.enabled = payload["enabled"]
    doc.revision += 1
    doc.updated_at = now_iso()
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=doc.id,
            object_label=doc.title,
            summary="知识启停",
            reason=str(doc.enabled),
        ),
    )
    session.flush()
    return detail(session, workspace, doc.id)
