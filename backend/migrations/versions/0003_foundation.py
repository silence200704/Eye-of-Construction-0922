"""Stage 2: foundation frozen schema."""

import sqlalchemy as sa
from alembic import op

revision = "0003_foundation"
down_revision = "0002_identity_only"
branch_labels = None
depends_on = None


def _create_datasets() -> None:
    op.create_table(
        "datasets",
        sa.Column("id", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), server_default="test", nullable=False),
        sa.Column("epoch", sa.Integer(), server_default="1", nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.CheckConstraint("kind IN ('test')"),
        sa.CheckConstraint("epoch > 0"),
        sa.PrimaryKeyConstraint("id"),
    )


def _create_audits() -> None:
    op.create_table(
        "audits",
        sa.Column("at", sa.String(), nullable=False),
        sa.Column("actor_id", sa.String(), nullable=True),
        sa.Column("actor", sa.String(), nullable=False),
        sa.Column("actor_role", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("object_type", sa.String(), nullable=False),
        sa.Column("object_id", sa.String(), nullable=False),
        sa.Column("object_label", sa.String(), server_default="", nullable=False),
        sa.Column("summary", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
    )
    op.create_index(op.f("ix_audits_at"), "audits", ["at"], unique=False)


def _create_import_batches() -> None:
    op.create_table(
        "import_batches",
        sa.Column("source_hash", sa.String(), nullable=False),
        sa.Column("source_name", sa.String(), nullable=False),
        sa.Column("imported_at", sa.String(), nullable=False),
        sa.Column("imported_by", sa.String(), nullable=False),
        sa.Column("report", sa.JSON(), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "source_hash"),
    )


def _create_operation_receipts() -> None:
    op.create_table(
        "operation_receipts",
        sa.Column("epoch", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.String(), nullable=False),
        sa.Column("operation", sa.String(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("request_hash", sa.String(), nullable=False),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("epoch > 0"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "epoch", "actor_id", "operation", "key"),
    )


def _create_preferences() -> None:
    op.create_table(
        "preferences",
        sa.Column("actor_id", sa.String(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "actor_id", "key"),
    )


def _create_session_states() -> None:
    op.create_table(
        "session_states",
        sa.Column("actor_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("state", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("kind IN ('assistant','scenario','showcase','video')"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
    )


def upgrade() -> None:
    _create_datasets()
    _create_audits()
    _create_import_batches()
    _create_operation_receipts()
    _create_preferences()
    _create_session_states()
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table("session_states")
    op.drop_table("preferences")
    op.drop_table("operation_receipts")
    op.drop_table("import_batches")
    op.drop_index(op.f("ix_audits_at"), table_name="audits")
    op.drop_table("audits")
    op.drop_table("datasets")
    # ### end Alembic commands ###
