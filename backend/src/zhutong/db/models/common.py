from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def reference(table: str, field: str) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(["dataset_id", field], [f"{table}.dataset_id", f"{table}.id"])


def unique(*fields: str) -> UniqueConstraint:
    return UniqueConstraint("dataset_id", *fields)


def choices(field: str, values: str) -> CheckConstraint:
    return CheckConstraint(f"{field} IN ({','.join(repr(v) for v in values.split())})")


def scoped(*constraints: object) -> tuple:
    return (CheckConstraint("revision > 0"), *constraints)


class DatasetRow:
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), primary_key=True)
    id: Mapped[str] = mapped_column(String(160), primary_key=True)
    revision: Mapped[int] = mapped_column(default=1, server_default="1")
    # 原导入行保留未知字段和来源；业务列及快照是正式查询与写入的权威字段。
    legacy_payload: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")


class AuditFields:
    created_at: Mapped[str] = mapped_column(default=now_iso)
    created_by: Mapped[str] = mapped_column(default="", server_default="")
    updated_at: Mapped[str] = mapped_column(default=now_iso)
    updated_by: Mapped[str] = mapped_column(default="", server_default="")


class ArchiveFields:
    status: Mapped[str] = mapped_column(default="active", server_default="active")
    archive_reason: Mapped[str] = mapped_column(default="", server_default="")
    archived_at: Mapped[str | None]
    archived_by: Mapped[str] = mapped_column(default="", server_default="")
