"""通用知识独立于业务数据集；版本与原文块不可变。"""

from sqlalchemy import JSON, ForeignKey, ForeignKeyConstraint, Text
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"
    id: Mapped[str] = mapped_column(primary_key=True)
    title: Mapped[str]
    source_path: Mapped[str]
    source_kind: Mapped[str]
    roles: Mapped[list] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(default=True)
    current_version: Mapped[int]
    revision: Mapped[int] = mapped_column(default=1)
    updated_at: Mapped[str]


class KnowledgeVersion(Base):
    __tablename__ = "knowledge_versions"
    document_id: Mapped[str] = mapped_column(ForeignKey("knowledge_documents.id"), primary_key=True)
    version: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str]
    created_at: Mapped[str]
    created_by: Mapped[str]


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["document_id", "version"],
            ["knowledge_versions.document_id", "knowledge_versions.version"],
        ),
    )
    id: Mapped[str] = mapped_column(primary_key=True)
    document_id: Mapped[str]
    version: Mapped[int]
    heading: Mapped[str]
    text: Mapped[str] = mapped_column(Text)
    line_start: Mapped[int]
    line_end: Mapped[int]
    sha256: Mapped[str]


class KnowledgeFAQ(Base):
    __tablename__ = "knowledge_faqs"
    id: Mapped[str] = mapped_column(primary_key=True)
    chunk_id: Mapped[str] = mapped_column(ForeignKey("knowledge_chunks.id"))
    questions: Mapped[list] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(default=True)
    revision: Mapped[int] = mapped_column(default=1)


class KnowledgeSynonym(Base):
    __tablename__ = "knowledge_synonyms"
    id: Mapped[str] = mapped_column(primary_key=True)
    canonical: Mapped[str] = mapped_column(unique=True)
    aliases: Mapped[list] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(default=True)
    revision: Mapped[int] = mapped_column(default=1)
