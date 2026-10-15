"""Stage 2: field frozen schema."""

import sqlalchemy as sa
from alembic import op

revision = "0006_field"
down_revision = "0005_monitoring"
branch_labels = None
depends_on = None


def _create_plans() -> None:
    op.create_table(
        "plans",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("building_id", sa.String(), nullable=False),
        sa.Column("floor_ids", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("point_ids", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("cycle", sa.JSON(), nullable=False),
        sa.Column("start_date", sa.String(), nullable=False),
        sa.Column("end_date", sa.String(), nullable=True),
        sa.Column("owner", sa.String(), nullable=False),
        sa.Column("executor_role", sa.String(), nullable=False),
        sa.Column("checklist", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("remark", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("kind IN ('inspection','patrol')"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "building_id"], ["buildings.dataset_id", "buildings.id"]
        ),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"]),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "code"),
    )


def _create_tasks() -> None:
    op.create_table(
        "tasks",
        sa.Column("task_no", sa.String(), nullable=False),
        sa.Column("plan_id", sa.String(), nullable=False),
        sa.Column("building_id", sa.String(), nullable=False),
        sa.Column("plan_snapshot", sa.JSON(), nullable=False),
        sa.Column("planned_at", sa.String(), nullable=False),
        sa.Column("due_at", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("results", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("issue_ids", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("status IN ('pending','checked','partial','missed')"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "building_id"], ["buildings.dataset_id", "buildings.id"]
        ),
        sa.ForeignKeyConstraint(["dataset_id", "plan_id"], ["plans.dataset_id", "plans.id"]),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"]),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "plan_id", "planned_at"),
        sa.UniqueConstraint("dataset_id", "task_no"),
    )
    op.create_index(op.f("ix_tasks_planned_at"), "tasks", ["planned_at"], unique=False)


def _create_maintenance_plans() -> None:
    op.create_table(
        "maintenance_plans",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("point_id", sa.String(), nullable=True),
        sa.Column("building_id", sa.String(), nullable=False),
        sa.Column("cycle", sa.JSON(), nullable=False),
        sa.Column("start_date", sa.String(), nullable=False),
        sa.Column("end_date", sa.String(), nullable=True),
        sa.Column("owner", sa.String(), nullable=False),
        sa.Column("checklist", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="1", nullable=False),
        sa.Column("remark", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "building_id"], ["buildings.dataset_id", "buildings.id"]
        ),
        sa.ForeignKeyConstraint(["dataset_id", "device_id"], ["devices.dataset_id", "devices.id"]),
        sa.ForeignKeyConstraint(["dataset_id", "point_id"], ["points.dataset_id", "points.id"]),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"]),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "code"),
    )


def _create_maintenance_tasks() -> None:
    op.create_table(
        "maintenance_tasks",
        sa.Column("task_no", sa.String(), nullable=False),
        sa.Column("plan_id", sa.String(), nullable=False),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("planned_at", sa.String(), nullable=False),
        sa.Column("due_at", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="pending", nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("execution", sa.JSON(), nullable=True),
        sa.Column("timeline", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("status IN ('pending','done')"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(["dataset_id", "device_id"], ["devices.dataset_id", "devices.id"]),
        sa.ForeignKeyConstraint(
            ["dataset_id", "plan_id"], ["maintenance_plans.dataset_id", "maintenance_plans.id"]
        ),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"]),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "plan_id", "planned_at"),
        sa.UniqueConstraint("dataset_id", "task_no"),
    )
    op.create_index(
        op.f("ix_maintenance_tasks_planned_at"), "maintenance_tasks", ["planned_at"], unique=False
    )


def _issue_references() -> tuple:
    return (
        sa.ForeignKeyConstraint(
            ["dataset_id", "building_id"], ["buildings.dataset_id", "buildings.id"]
        ),
        sa.ForeignKeyConstraint(["dataset_id", "duplicate_of"], ["issues.dataset_id", "issues.id"]),
        sa.ForeignKeyConstraint(["dataset_id", "event_id"], ["events.dataset_id", "events.id"]),
        sa.ForeignKeyConstraint(
            ["dataset_id", "floor_id", "building_id"],
            ["floors.dataset_id", "floors.id", "floors.building_id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "linked_event_id"], ["events.dataset_id", "events.id"]
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "maintenance_task_id"],
            ["maintenance_tasks.dataset_id", "maintenance_tasks.id"],
        ),
        sa.ForeignKeyConstraint(["dataset_id", "point_id"], ["points.dataset_id", "points.id"]),
        sa.ForeignKeyConstraint(["dataset_id", "task_id"], ["tasks.dataset_id", "tasks.id"]),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"]),
    )


def _create_issues() -> None:
    op.create_table(
        "issues",
        sa.Column("issue_no", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("submission_key", sa.String(), nullable=False),
        sa.Column("point_id", sa.String(), nullable=True),
        sa.Column("building_id", sa.String(), nullable=False),
        sa.Column("floor_id", sa.String(), nullable=True),
        sa.Column("zone_id", sa.String(), server_default="", nullable=False),
        sa.Column("event_id", sa.String(), nullable=True),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("maintenance_task_id", sa.String(), nullable=True),
        sa.Column("anomaly_type", sa.String(), server_default="", nullable=False),
        sa.Column("description", sa.String(), nullable=False),
        sa.Column("photos", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("status", sa.String(), server_default="pending_review", nullable=False),
        sa.Column("review_action", sa.String(), nullable=True),
        sa.Column("review_category", sa.String(), server_default="", nullable=False),
        sa.Column("reviewed_at", sa.String(), nullable=True),
        sa.Column("reviewed_by", sa.String(), server_default="", nullable=False),
        sa.Column("review_note", sa.String(), server_default="", nullable=False),
        sa.Column("duplicate_of", sa.String(), nullable=True),
        sa.Column("linked_event_id", sa.String(), nullable=True),
        sa.Column("linked_from", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("work_order_ids", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("rechecks", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("timeline", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("source IN ('sensor','inspection','report','maintenance')"),
        sa.CheckConstraint(
            "status IN ('pending_review','investigating','repairing',"
            "'pending_recheck','observing','closed')"
        ),
        sa.CheckConstraint("revision > 0"),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "issue_no"),
        sa.UniqueConstraint("dataset_id", "submission_key"),
        *_issue_references(),
    )


def _create_work_orders() -> None:
    op.create_table(
        "work_orders",
        sa.Column("order_no", sa.String(), nullable=False),
        sa.Column("origin", sa.String(), nullable=False),
        sa.Column("issue_id", sa.String(), nullable=True),
        sa.Column("event_id", sa.String(), nullable=True),
        sa.Column("point_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("status", sa.String(), server_default="created", nullable=False),
        sa.Column("assignee", sa.String(), server_default="", nullable=False),
        sa.Column("assigned_by", sa.String(), server_default="", nullable=False),
        sa.Column("assigned_at", sa.String(), nullable=True),
        sa.Column("due_at", sa.String(), nullable=True),
        sa.Column("measures", sa.String(), server_default="", nullable=False),
        sa.Column("materials", sa.String(), server_default="", nullable=False),
        sa.Column("photos", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("submitted_at", sa.String(), nullable=True),
        sa.Column("reviews", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("timeline", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("origin IN ('manual','event','issue')"),
        sa.CheckConstraint(
            "status IN ('created','assigned','repairing','submitted','verified','returned')"
        ),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(["dataset_id", "event_id"], ["events.dataset_id", "events.id"]),
        sa.ForeignKeyConstraint(["dataset_id", "issue_id"], ["issues.dataset_id", "issues.id"]),
        sa.ForeignKeyConstraint(["dataset_id", "point_id"], ["points.dataset_id", "points.id"]),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"]),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "order_no"),
    )


def upgrade() -> None:
    _create_plans()
    _create_tasks()
    _create_maintenance_plans()
    _create_maintenance_tasks()
    _create_issues()
    _create_work_orders()


def downgrade() -> None:
    op.drop_table("work_orders")
    op.drop_table("issues")
    op.drop_index(op.f("ix_maintenance_tasks_planned_at"), table_name="maintenance_tasks")
    op.drop_table("maintenance_tasks")
    op.drop_table("maintenance_plans")
    op.drop_index(op.f("ix_tasks_planned_at"), table_name="tasks")
    op.drop_table("tasks")
    op.drop_table("plans")
