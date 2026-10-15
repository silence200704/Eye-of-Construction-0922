from sqlalchemy import JSON, CheckConstraint, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import DatasetRow, choices, now_iso, scoped, unique


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (CheckConstraint("epoch > 0"), choices("kind", "test"))
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    name: Mapped[str]
    kind: Mapped[str] = mapped_column(default="test", server_default="test")
    epoch: Mapped[int] = mapped_column(default=1, server_default="1")
    enabled: Mapped[bool] = mapped_column(default=True, server_default="1")
    created_at: Mapped[str] = mapped_column(default=now_iso)


class AuditLog(DatasetRow, Base):
    __tablename__ = "audits"
    __table_args__ = scoped()
    at: Mapped[str] = mapped_column(default=now_iso, index=True)
    actor_id: Mapped[str | None]
    actor: Mapped[str]
    actor_role: Mapped[str]
    action: Mapped[str]
    object_type: Mapped[str]
    object_id: Mapped[str]
    object_label: Mapped[str] = mapped_column(default="", server_default="")
    summary: Mapped[str]
    reason: Mapped[str] = mapped_column(default="", server_default="")


class OperationReceipt(DatasetRow, Base):
    __tablename__ = "operation_receipts"
    __table_args__ = scoped(
        unique("epoch", "actor_id", "operation", "key"), CheckConstraint("epoch > 0")
    )
    epoch: Mapped[int]
    actor_id: Mapped[str]
    operation: Mapped[str]
    key: Mapped[str]
    request_hash: Mapped[str]
    response: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(default=now_iso)


class Preference(DatasetRow, Base):
    __tablename__ = "preferences"
    __table_args__ = scoped(unique("actor_id", "key"))
    actor_id: Mapped[str]
    key: Mapped[str]
    value: Mapped[dict] = mapped_column(JSON)


class SessionState(DatasetRow, Base):
    __tablename__ = "session_states"
    __table_args__ = scoped(choices("kind", "assistant scenario showcase video"))
    actor_id: Mapped[str]
    kind: Mapped[str]
    state: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[str] = mapped_column(default=now_iso)


class ImportBatch(DatasetRow, Base):
    __tablename__ = "import_batches"
    __table_args__ = scoped(UniqueConstraint("dataset_id", "source_hash"))
    source_hash: Mapped[str]
    source_name: Mapped[str]
    imported_at: Mapped[str] = mapped_column(default=now_iso)
    imported_by: Mapped[str]
    report: Mapped[dict] = mapped_column(JSON)
