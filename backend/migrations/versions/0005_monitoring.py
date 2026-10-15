"""Stage 2: monitoring frozen schema."""

import sqlalchemy as sa
from alembic import op

revision = "0005_monitoring"
down_revision = "0004_archive"
branch_labels = None
depends_on = None


def _create_rule_definitions() -> None:
    op.create_table(
        "rule_definitions",
        sa.Column("code", sa.String(), nullable=False),
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
        sa.UniqueConstraint("dataset_id", "code"),
    )


def _create_rules() -> None:
    op.create_table(
        "rules",
        sa.Column("rule_id", sa.String(), nullable=False),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("effective_from", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("building_ids", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("point_ids", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("baseline_source", sa.String(), nullable=False),
        sa.Column("fixed_baseline", sa.JSON(), nullable=True),
        sa.Column("thresholds", sa.JSON(), nullable=True),
        sa.Column("rate_threshold", sa.Double(), nullable=True),
        sa.Column("rate_level", sa.String(), server_default="orange", nullable=False),
        sa.Column("persistence", sa.JSON(), nullable=False),
        sa.Column("recovery", sa.JSON(), nullable=False),
        sa.Column("environment", sa.JSON(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("confirmed_by", sa.String(), nullable=False),
        sa.Column("note", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("baseline_source IN ('point','fixed','none')"),
        sa.CheckConstraint("metric IN ('crack_width','tilt_xy','vibration','environment')"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "rule_id"],
            ["rule_definitions.dataset_id", "rule_definitions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "rule_id", "version"),
    )
    op.create_index(op.f("ix_rules_effective_from"), "rules", ["effective_from"], unique=False)


def _create_baselines() -> None:
    op.create_table(
        "baselines",
        sa.Column("point_id", sa.String(), nullable=False),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("values", sa.JSON(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), server_default="", nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("created_at", sa.String(), server_default="", nullable=False),
        sa.Column("current", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("revision > 0"),
        sa.CheckConstraint("version > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "point_id"],
            ["points.dataset_id", "points.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "point_id", "metric", "version"),
    )
    op.create_index(
        op.f("ix_baselines_effective_from"), "baselines", ["effective_from"], unique=False
    )
    op.create_index(
        "uq_current_baseline",
        "baselines",
        ["dataset_id", "point_id", "metric"],
        unique=True,
        sqlite_where=sa.text("current=1"),
    )


def _create_events() -> None:
    op.create_table(
        "events",
        sa.Column("event_no", sa.String(), nullable=False),
        sa.Column("point_id", sa.String(), nullable=False),
        sa.Column("rule_id", sa.String(), nullable=False),
        sa.Column("rule_code", sa.String(), nullable=False),
        sa.Column("level", sa.String(), nullable=False),
        sa.Column("peak_level", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("opened_at", sa.String(), nullable=False),
        sa.Column("opened_by", sa.String(), nullable=False),
        sa.Column("last_trigger_at", sa.String(), nullable=False),
        sa.Column("last_trigger_value", sa.Double(), nullable=False),
        sa.Column("evidences", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("superseded_evidences", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("upgrades", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("timeline", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("acknowledged_at", sa.String(), nullable=True),
        sa.Column("acknowledged_by", sa.String(), server_default="", nullable=False),
        sa.Column("closed_at", sa.String(), nullable=True),
        sa.Column("closed_by", sa.String(), server_default="", nullable=False),
        sa.Column("close_basis", sa.String(), server_default="", nullable=False),
        sa.Column("note", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("level IN ('yellow','orange','red')"),
        sa.CheckConstraint("peak_level IN ('yellow','orange','red')"),
        sa.CheckConstraint("status IN ('pending','handling','recovering','closed')"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "point_id"],
            ["points.dataset_id", "points.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "rule_id"],
            ["rule_definitions.dataset_id", "rule_definitions.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "event_no"),
    )
    op.create_index(op.f("ix_events_last_trigger_at"), "events", ["last_trigger_at"], unique=False)
    op.create_index(
        "uq_active_event",
        "events",
        ["dataset_id", "point_id", "rule_id"],
        unique=True,
        sqlite_where=sa.text("status != 'closed'"),
    )


def _create_notifications() -> None:
    op.create_table(
        "notifications",
        sa.Column("event_id", sa.String(), nullable=False),
        sa.Column("event_no", sa.String(), nullable=False),
        sa.Column("level", sa.String(), nullable=False),
        sa.Column("target", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("presented_at", sa.String(), nullable=True),
        sa.Column("acknowledged_at", sa.String(), nullable=True),
        sa.Column("acknowledged_by", sa.String(), server_default="", nullable=False),
        sa.Column("due_minutes", sa.Integer(), nullable=False),
        sa.Column("fallback", sa.String(), nullable=False),
        sa.Column("escalated_at", sa.String(), nullable=True),
        sa.Column("escalated_to", sa.String(), server_default="", nullable=False),
        sa.Column("escalation_source", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("level IN ('yellow','orange','red')"),
        sa.CheckConstraint("due_minutes > 0"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "event_id"],
            ["events.dataset_id", "events.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
    )
    op.create_index(
        op.f("ix_notifications_created_at"), "notifications", ["created_at"], unique=False
    )


def _create_records() -> None:
    op.create_table(
        "records",
        sa.Column("record_no", sa.String(), nullable=False),
        sa.Column("point_id", sa.String(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=True),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("values", sa.JSON(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("sample_time", sa.String(), nullable=False),
        sa.Column("sample_window", sa.String(), server_default="", nullable=False),
        sa.Column("entered_at", sa.String(), nullable=False),
        sa.Column("entered_by", sa.String(), nullable=False),
        sa.Column("entered_by_role", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("quality", sa.String(), nullable=False),
        sa.Column("quality_note", sa.String(), server_default="", nullable=False),
        sa.Column("note", sa.String(), server_default="", nullable=False),
        sa.Column("is_backfill", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("baseline_version", sa.Integer(), nullable=True),
        sa.Column("baseline_values", sa.JSON(), nullable=True),
        sa.Column("revisions", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.CheckConstraint("quality IN ('valid','suspect','invalid')"),
        sa.CheckConstraint("source IN ('manual','device','csv')"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "device_id"],
            ["devices.dataset_id", "devices.id"],
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
        sa.UniqueConstraint("dataset_id", "point_id", "sample_time"),
        sa.UniqueConstraint("dataset_id", "record_no"),
    )
    op.create_index(op.f("ix_records_sample_time"), "records", ["sample_time"], unique=False)


def upgrade() -> None:
    _create_rule_definitions()
    _create_rules()
    _create_baselines()
    _create_events()
    _create_notifications()
    _create_records()
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_index(op.f("ix_records_sample_time"), table_name="records")
    op.drop_table("records")
    op.drop_index(op.f("ix_notifications_created_at"), table_name="notifications")
    op.drop_table("notifications")
    op.drop_index(
        "uq_active_event", table_name="events", sqlite_where=sa.text("status != 'closed'")
    )
    op.drop_index(op.f("ix_events_last_trigger_at"), table_name="events")
    op.drop_table("events")
    op.drop_index("uq_current_baseline", table_name="baselines", sqlite_where=sa.text("current=1"))
    op.drop_index(op.f("ix_baselines_effective_from"), table_name="baselines")
    op.drop_table("baselines")
    op.drop_index(op.f("ix_rules_effective_from"), table_name="rules")
    op.drop_table("rules")
    op.drop_table("rule_definitions")
    # ### end Alembic commands ###
