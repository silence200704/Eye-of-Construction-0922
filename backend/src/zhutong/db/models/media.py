from sqlalchemy import JSON, CheckConstraint, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import DatasetRow, choices, now_iso, reference, scoped, unique


class MediaFile(DatasetRow, Base):
    __tablename__ = "media_files"
    __table_args__ = scoped(
        reference("points", "point_id"),
        unique("uploaded_by", "draft_key"),
        CheckConstraint("size > 0"),
        CheckConstraint("width >= 0 AND height >= 0"),
        choices("origin", "upload video_frame demo_generated demo_public demo_evidence"),
    )
    file_name: Mapped[str]
    mime_type: Mapped[str]
    size: Mapped[int]
    sha256: Mapped[str] = mapped_column(index=True)
    storage_key: Mapped[str] = mapped_column(unique=True)
    width: Mapped[int]
    height: Mapped[int]
    point_id: Mapped[str | None]
    origin: Mapped[str] = mapped_column(default="upload", server_default="upload")
    draft_key: Mapped[str | None]
    captured_at: Mapped[str | None]
    uploaded_at: Mapped[str] = mapped_column(default=now_iso)
    uploaded_by: Mapped[str] = mapped_column(ForeignKey("users.id"))


class Attachment(DatasetRow, Base):
    __tablename__ = "attachments"
    __table_args__ = scoped(
        reference("media_files", "media_id"),
        reference("media_files", "thumb_id"),
        reference("issues", "issue_id"),
        reference("work_orders", "work_order_id"),
        reference("maintenance_tasks", "maintenance_task_id"),
        CheckConstraint(
            "(issue_id IS NOT NULL) + (work_order_id IS NOT NULL) + (maintenance_task_id IS NOT NULL) = 1"
        ),
        choices("kind", "scene before after acceptance"),
        unique("draft_id"),
        Index(
            "ix_attachment_owner", "dataset_id", "issue_id", "work_order_id", "maintenance_task_id"
        ),
    )
    media_id: Mapped[str]
    thumb_id: Mapped[str | None]
    issue_id: Mapped[str | None]
    work_order_id: Mapped[str | None]
    maintenance_task_id: Mapped[str | None]
    kind: Mapped[str]
    draft_id: Mapped[str]


class MediaVideo(DatasetRow, Base):
    __tablename__ = "media_videos"
    __table_args__ = scoped(reference("media_files", "media_id"), reference("points", "point_id"))
    media_id: Mapped[str]
    point_id: Mapped[str]
    metadata_snapshot: Mapped[dict] = mapped_column(JSON)
    analysis: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class MediaFrame(DatasetRow, Base):
    __tablename__ = "media_frames"
    __table_args__ = scoped(
        reference("media_files", "media_id"),
        reference("points", "point_id"),
        reference("media_videos", "video_id"),
        CheckConstraint("time_code IS NULL OR time_code >= 0"),
    )
    media_id: Mapped[str]
    point_id: Mapped[str]
    video_id: Mapped[str | None]
    time_code: Mapped[float | None]
    label: Mapped[str]
    captured_at: Mapped[str]


class MediaComparison(DatasetRow, Base):
    __tablename__ = "media_comparisons"
    __table_args__ = scoped(
        reference("points", "point_id"),
        reference("media_frames", "before_id"),
        reference("media_frames", "after_id"),
    )
    point_id: Mapped[str]
    before_id: Mapped[str]
    after_id: Mapped[str]
    result: Mapped[dict] = mapped_column(JSON)
