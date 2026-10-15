"""Stage 2: media frozen schema."""

import sqlalchemy as sa
from alembic import op

revision = "0007_media"
down_revision = "0006_field"
branch_labels = None
depends_on = None


def _create_media_files() -> None:
    op.create_table(
        "media_files",
        sa.Column("file_name", sa.String(), nullable=False),
        sa.Column("mime_type", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("storage_key", sa.String(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("point_id", sa.String(), nullable=True),
        sa.Column("origin", sa.String(), server_default="upload", nullable=False),
        sa.Column("draft_key", sa.String(), nullable=True),
        sa.Column("captured_at", sa.String(), nullable=True),
        sa.Column("uploaded_at", sa.String(), nullable=False),
        sa.Column("uploaded_by", sa.String(length=80), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint(
            "origin IN ('upload','video_frame','demo_generated','demo_public','demo_evidence')"
        ),
        sa.CheckConstraint("revision > 0"),
        sa.CheckConstraint("size > 0"),
        sa.CheckConstraint("width >= 0 AND height >= 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "point_id"],
            ["points.dataset_id", "points.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "uploaded_by", "draft_key"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index(op.f("ix_media_files_sha256"), "media_files", ["sha256"], unique=False)


def _create_media_videos() -> None:
    op.create_table(
        "media_videos",
        sa.Column("media_id", sa.String(), nullable=False),
        sa.Column("point_id", sa.String(), nullable=False),
        sa.Column("metadata_snapshot", sa.JSON(), nullable=False),
        sa.Column("analysis", sa.JSON(), nullable=True),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "media_id"],
            ["media_files.dataset_id", "media_files.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "point_id"],
            ["points.dataset_id", "points.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
    )


def _create_media_frames() -> None:
    op.create_table(
        "media_frames",
        sa.Column("media_id", sa.String(), nullable=False),
        sa.Column("point_id", sa.String(), nullable=False),
        sa.Column("video_id", sa.String(), nullable=True),
        sa.Column("time_code", sa.Double(), nullable=True),
        sa.Column("label", sa.String(), nullable=False),
        sa.Column("captured_at", sa.String(), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("revision > 0"),
        sa.CheckConstraint("time_code IS NULL OR time_code >= 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "media_id"],
            ["media_files.dataset_id", "media_files.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "point_id"],
            ["points.dataset_id", "points.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "video_id"],
            ["media_videos.dataset_id", "media_videos.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
    )


def _create_media_comparisons() -> None:
    op.create_table(
        "media_comparisons",
        sa.Column("point_id", sa.String(), nullable=False),
        sa.Column("before_id", sa.String(), nullable=False),
        sa.Column("after_id", sa.String(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "after_id"],
            ["media_frames.dataset_id", "media_frames.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "before_id"],
            ["media_frames.dataset_id", "media_frames.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "point_id"],
            ["points.dataset_id", "points.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
    )


def _create_attachments() -> None:
    op.create_table(
        "attachments",
        sa.Column("media_id", sa.String(), nullable=False),
        sa.Column("thumb_id", sa.String(), nullable=True),
        sa.Column("issue_id", sa.String(), nullable=True),
        sa.Column("work_order_id", sa.String(), nullable=True),
        sa.Column("maintenance_task_id", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("draft_id", sa.String(), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("kind IN ('scene','before','after','acceptance')"),
        sa.CheckConstraint(
            "(issue_id IS NOT NULL) + (work_order_id IS NOT NULL)"
            " + (maintenance_task_id IS NOT NULL) = 1"
        ),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "issue_id"],
            ["issues.dataset_id", "issues.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "maintenance_task_id"],
            ["maintenance_tasks.dataset_id", "maintenance_tasks.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "media_id"],
            ["media_files.dataset_id", "media_files.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "thumb_id"],
            ["media_files.dataset_id", "media_files.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "work_order_id"],
            ["work_orders.dataset_id", "work_orders.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "draft_id"),
    )
    op.create_index(
        "ix_attachment_owner",
        "attachments",
        ["dataset_id", "issue_id", "work_order_id", "maintenance_task_id"],
        unique=False,
    )


def upgrade() -> None:
    _create_media_files()
    _create_media_videos()
    _create_media_frames()
    _create_media_comparisons()
    _create_attachments()
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index("ix_attachment_owner", table_name="attachments")
    op.drop_table("attachments")
    op.drop_table("media_comparisons")
    op.drop_table("media_frames")
    op.drop_table("media_videos")
    op.drop_index(op.f("ix_media_files_sha256"), table_name="media_files")
    op.drop_table("media_files")
    # ### end Alembic commands ###
