from sqlalchemy import JSON, ForeignKeyConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import AuditFields, DatasetRow, choices, reference, scoped, unique


class InspectionPlan(DatasetRow, AuditFields, Base):
    __tablename__ = "plans"
    __table_args__ = scoped(
        reference("buildings", "building_id"), unique("code"), choices("kind", "inspection patrol")
    )
    code: Mapped[str]
    name: Mapped[str]
    kind: Mapped[str]
    building_id: Mapped[str]
    floor_ids: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    point_ids: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    cycle: Mapped[dict] = mapped_column(JSON)
    start_date: Mapped[str]
    end_date: Mapped[str | None]
    owner: Mapped[str]
    executor_role: Mapped[str]
    checklist: Mapped[list] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(default=True, server_default="1")
    remark: Mapped[str] = mapped_column(default="", server_default="")


class InspectionTask(DatasetRow, AuditFields, Base):
    __tablename__ = "tasks"
    __table_args__ = scoped(
        reference("plans", "plan_id"),
        reference("buildings", "building_id"),
        unique("task_no"),
        unique("plan_id", "planned_at"),
        choices("status", "pending checked partial missed"),
    )
    task_no: Mapped[str]
    plan_id: Mapped[str]
    building_id: Mapped[str]
    plan_snapshot: Mapped[dict] = mapped_column(JSON)
    planned_at: Mapped[str] = mapped_column(index=True)
    due_at: Mapped[str]
    status: Mapped[str] = mapped_column(default="pending", server_default="pending")
    results: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    issue_ids: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")


class MaintenancePlan(DatasetRow, AuditFields, Base):
    __tablename__ = "maintenance_plans"
    __table_args__ = scoped(
        reference("devices", "device_id"),
        reference("points", "point_id"),
        reference("buildings", "building_id"),
        unique("code"),
    )
    code: Mapped[str]
    name: Mapped[str]
    device_id: Mapped[str]
    point_id: Mapped[str | None]
    building_id: Mapped[str]
    cycle: Mapped[dict] = mapped_column(JSON)
    start_date: Mapped[str]
    end_date: Mapped[str | None]
    owner: Mapped[str]
    checklist: Mapped[list] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(default=True, server_default="1")
    remark: Mapped[str] = mapped_column(default="", server_default="")


class MaintenanceTask(DatasetRow, AuditFields, Base):
    __tablename__ = "maintenance_tasks"
    __table_args__ = scoped(
        reference("maintenance_plans", "plan_id"),
        reference("devices", "device_id"),
        unique("task_no"),
        unique("plan_id", "planned_at"),
        choices("status", "pending done"),
    )
    task_no: Mapped[str]
    plan_id: Mapped[str]
    device_id: Mapped[str]
    planned_at: Mapped[str] = mapped_column(index=True)
    due_at: Mapped[str]
    status: Mapped[str] = mapped_column(default="pending", server_default="pending")
    snapshot: Mapped[dict] = mapped_column(JSON)
    execution: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timeline: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")


class Issue(DatasetRow, AuditFields, Base):
    __tablename__ = "issues"
    __table_args__ = scoped(
        reference("points", "point_id"),
        reference("buildings", "building_id"),
        ForeignKeyConstraint(
            ["dataset_id", "floor_id", "building_id"],
            ["floors.dataset_id", "floors.id", "floors.building_id"],
        ),
        reference("events", "event_id"),
        reference("tasks", "task_id"),
        reference("maintenance_tasks", "maintenance_task_id"),
        reference("issues", "duplicate_of"),
        reference("events", "linked_event_id"),
        unique("issue_no"),
        unique("submission_key"),
        choices("source", "sensor inspection report maintenance"),
        choices(
            "status", "pending_review investigating repairing pending_recheck observing closed"
        ),
    )
    issue_no: Mapped[str]
    source: Mapped[str]
    submission_key: Mapped[str]
    point_id: Mapped[str | None]
    building_id: Mapped[str]
    floor_id: Mapped[str | None]
    zone_id: Mapped[str] = mapped_column(default="", server_default="")
    event_id: Mapped[str | None]
    task_id: Mapped[str | None]
    maintenance_task_id: Mapped[str | None]
    anomaly_type: Mapped[str] = mapped_column(default="", server_default="")
    description: Mapped[str]
    photos: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    status: Mapped[str] = mapped_column(default="pending_review", server_default="pending_review")
    review_action: Mapped[str | None]
    review_category: Mapped[str] = mapped_column(default="", server_default="")
    reviewed_at: Mapped[str | None]
    reviewed_by: Mapped[str] = mapped_column(default="", server_default="")
    review_note: Mapped[str] = mapped_column(default="", server_default="")
    duplicate_of: Mapped[str | None]
    linked_event_id: Mapped[str | None]
    linked_from: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    work_order_ids: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    rechecks: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    timeline: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")


class WorkOrder(DatasetRow, AuditFields, Base):
    __tablename__ = "work_orders"
    __table_args__ = scoped(
        reference("issues", "issue_id"),
        reference("events", "event_id"),
        reference("points", "point_id"),
        unique("order_no"),
        choices("origin", "manual event issue"),
        choices("status", "created assigned repairing submitted verified returned"),
    )
    order_no: Mapped[str]
    origin: Mapped[str]
    issue_id: Mapped[str | None]
    event_id: Mapped[str | None]
    point_id: Mapped[str | None]
    title: Mapped[str]
    status: Mapped[str] = mapped_column(default="created", server_default="created")
    assignee: Mapped[str] = mapped_column(default="", server_default="")
    assignee_id: Mapped[str] = mapped_column(default="", server_default="")
    assigned_by: Mapped[str] = mapped_column(default="", server_default="")
    assigned_at: Mapped[str | None]
    accepted_by_id: Mapped[str] = mapped_column(default="", server_default="")
    due_at: Mapped[str | None]
    measures: Mapped[str] = mapped_column(default="", server_default="")
    materials: Mapped[str] = mapped_column(default="", server_default="")
    photos: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    submitted_at: Mapped[str | None]
    reviews: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    timeline: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
