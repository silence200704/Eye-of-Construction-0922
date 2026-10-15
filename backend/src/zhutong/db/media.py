import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict, fields

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..operations.media.attachments import attachment_fields, owner_field
from ..operations.media.types import AttachmentSpec, MediaContext, MediaRecord, Owner
from .models.archive import Point
from .models.field import Issue, MaintenanceTask, WorkOrder
from .models.foundation import AuditLog, Dataset
from .models.media import Attachment, MediaFile


def file_record(row: MediaFile) -> MediaRecord:
    return MediaRecord(**{field.name: getattr(row, field.name) for field in fields(MediaRecord)})


def attachment_record(row: Attachment) -> dict:
    spec = AttachmentSpec(
        **{field.name: getattr(row, field.name) for field in fields(AttachmentSpec)}
    )
    return {"id": row.id, **attachment_fields(spec)}


class SqlMediaRepository:
    def __init__(self, session: Session) -> None:
        self.db = session

    @contextmanager
    def write(self) -> Iterator[None]:
        with self.db.begin():
            self.db.execute(text("BEGIN IMMEDIATE"))
            yield

    def datasets(self) -> list[dict]:
        rows = self.db.scalars(select(Dataset).where(Dataset.enabled.is_(True)))
        return [
            {"id": row.id, "name": row.name, "kind": row.kind, "epoch": row.epoch} for row in rows
        ]

    def dataset_exists(self, dataset_id: str) -> bool:
        row = self.db.get(Dataset, dataset_id)
        return row is not None and row.enabled

    def point_building(self, dataset_id: str, point_id: str) -> str | None:
        row = self.db.get(Point, (dataset_id, point_id))
        return row.building_id if row else None

    def get_file(self, dataset_id: str, file_id: str) -> MediaRecord | None:
        row = self.db.get(MediaFile, (dataset_id, file_id))
        return file_record(row) if row else None

    def by_draft(self, context: MediaContext, key: str) -> MediaRecord | None:
        row = self.db.scalar(
            select(MediaFile).where(
                MediaFile.dataset_id == context.dataset_id,
                MediaFile.uploaded_by == context.actor.id,
                MediaFile.draft_key == key,
            )
        )
        return file_record(row) if row else None

    def save_file(self, context: MediaContext, record: MediaRecord) -> None:
        self.db.add(MediaFile(**asdict(record)))
        self.audit(context, record.id, "media", "upload")
        self.db.flush()

    def audit(self, context: MediaContext, identifier: str, object_type: str, action: str) -> None:
        self.db.add(
            AuditLog(
                dataset_id=context.dataset_id,
                id=uuid.uuid4().hex,
                actor_id=context.actor.id,
                actor=context.actor.name,
                actor_role=context.actor.role,
                action=action,
                object_type=object_type,
                object_id=identifier,
                summary=f"{action} {object_type}",
            )
        )

    def owner(self, dataset_id: str, spec: AttachmentSpec) -> Owner | None:
        field, identifier = owner_field(spec)
        model = {
            "issue_id": Issue,
            "work_order_id": WorkOrder,
            "maintenance_task_id": MaintenanceTask,
        }[field]
        row = self.db.get(model, (dataset_id, identifier))
        if row is None:
            return None
        if isinstance(row, Issue):
            return Owner(row.building_id, row.point_id)
        if isinstance(row, MaintenanceTask):
            return Owner(row.snapshot.get("buildingId"), row.snapshot.get("pointId"))
        if row.point_id:
            return Owner(self.point_building(dataset_id, row.point_id), row.point_id)
        issue = self.db.get(Issue, (dataset_id, row.issue_id)) if row.issue_id else None
        return Owner(issue.building_id, issue.point_id) if issue else Owner(None, None)

    def attachment(self, dataset_id: str, draft_id: str) -> dict | None:
        row = self.db.scalar(
            select(Attachment).where(
                Attachment.dataset_id == dataset_id, Attachment.draft_id == draft_id
            )
        )
        return attachment_record(row) if row else None

    def owner_totals(self, dataset_id: str, spec: AttachmentSpec) -> tuple[int, int]:
        field, identifier = owner_field(spec)
        statement = (
            select(func.count(), func.coalesce(func.sum(MediaFile.size), 0))
            .select_from(Attachment)
            .join(
                MediaFile,
                (MediaFile.dataset_id == Attachment.dataset_id)
                & (MediaFile.id == Attachment.media_id),
            )
            .where(Attachment.dataset_id == dataset_id, getattr(Attachment, field) == identifier)
        )
        count, size = self.db.execute(statement).one()
        return count, size

    def media_attached(self, dataset_id: str, media_id: str) -> bool:
        return (
            self.db.scalar(
                select(Attachment.id)
                .where(Attachment.dataset_id == dataset_id, Attachment.media_id == media_id)
                .limit(1)
            )
            is not None
        )

    def save_attachment(self, context: MediaContext, spec: AttachmentSpec) -> dict:
        row = Attachment(dataset_id=context.dataset_id, id=uuid.uuid4().hex, **asdict(spec))
        self.db.add(row)
        self.audit(context, row.id, "attachment", "link")
        self.db.flush()
        return attachment_record(row)
