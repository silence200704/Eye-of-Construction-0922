from sqlalchemy import ForeignKey, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column

from ...database import Base


class KnowledgeIndex(Base):
    __tablename__ = "knowledge_indexes"
    id: Mapped[str] = mapped_column(primary_key=True)
    model_id: Mapped[str]
    model_revision: Mapped[str]
    manifest_hash: Mapped[str]
    dimension: Mapped[int]
    corpus_hash: Mapped[str]
    vector_count: Mapped[int]
    created_at: Mapped[str]


class KnowledgeVector(Base):
    __tablename__ = "knowledge_vectors"
    index_id: Mapped[str] = mapped_column(ForeignKey("knowledge_indexes.id"), primary_key=True)
    chunk_id: Mapped[str] = mapped_column(ForeignKey("knowledge_chunks.id"), primary_key=True)
    embedding: Mapped[bytes] = mapped_column(LargeBinary)
    sha256: Mapped[str]


class KnowledgeState(Base):
    __tablename__ = "knowledge_state"
    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    active_index_id: Mapped[str | None] = mapped_column(ForeignKey("knowledge_indexes.id"))
    last_error: Mapped[str] = mapped_column(default="")
