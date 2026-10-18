from sqlalchemy import JSON, CheckConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import AuditFields, DatasetRow, choices, reference, scoped, unique


class Baseline(DatasetRow, Base):
    __tablename__ = "baselines"
    __table_args__ = scoped(
        reference("points", "point_id"),
        unique("point_id", "metric", "version"),
        CheckConstraint("version > 0"),
        Index(
            "uq_current_baseline",
            "dataset_id",
            "point_id",
            "metric",
            unique=True,
            sqlite_where=text("current=1"),
        ),
    )
    point_id: Mapped[str]
    metric: Mapped[str]
    values: Mapped[dict] = mapped_column(JSON)
    unit: Mapped[str]
    version: Mapped[int]
    effective_from: Mapped[str] = mapped_column(index=True)
    reason: Mapped[str] = mapped_column(default="", server_default="")
    created_by: Mapped[str] = mapped_column(default="", server_default="")
    created_at: Mapped[str] = mapped_column(default="", server_default="")
    current: Mapped[bool] = mapped_column(default=False, server_default="0")


class MonitorRecord(DatasetRow, Base):
    __tablename__ = "records"
    __table_args__ = scoped(
        reference("points", "point_id"),
        reference("devices", "device_id"),
        unique("record_no"),
        unique("point_id", "sample_time"),
        choices("quality", "valid suspect invalid"),
        choices("source", "manual device csv"),
    )
    record_no: Mapped[str]
    point_id: Mapped[str]
    device_id: Mapped[str | None]
    metric: Mapped[str]
    values: Mapped[dict] = mapped_column(JSON)
    unit: Mapped[str]
    sample_time: Mapped[str] = mapped_column(index=True)
    sample_window: Mapped[str] = mapped_column(default="", server_default="")
    entered_at: Mapped[str]
    entered_by: Mapped[str]
    entered_by_role: Mapped[str]
    source: Mapped[str]
    quality: Mapped[str]
    quality_note: Mapped[str] = mapped_column(default="", server_default="")
    note: Mapped[str] = mapped_column(default="", server_default="")
    is_backfill: Mapped[bool] = mapped_column(default=False, server_default="0")
    baseline_version: Mapped[int | None]
    baseline_values: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    revisions: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    created_at: Mapped[str]
    # 旧业务的修订次数从 0 开始，与服务端乐观锁 revision 分开。
    record_revision: Mapped[int] = mapped_column(default=0, server_default="0")
    # 录入/修订时按采样时间选中的规则版本与判定快照，保证历史解释不随新阈值漂移。
    rule_id: Mapped[str | None]
    rule_version: Mapped[str | None]
    rule_snapshot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    assessment: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class RuleDefinition(DatasetRow, Base):
    __tablename__ = "rule_definitions"
    __table_args__ = scoped(unique("code"))
    code: Mapped[str]


class MonitoringRule(DatasetRow, AuditFields, Base):
    __tablename__ = "rules"
    __table_args__ = scoped(
        reference("rule_definitions", "rule_id"),
        unique("rule_id", "version"),
        choices("metric", "crack_width tilt_xy vibration environment"),
        choices("baseline_source", "point fixed none"),
    )
    rule_id: Mapped[str]
    code: Mapped[str]
    name: Mapped[str]
    metric: Mapped[str]
    unit: Mapped[str]
    version: Mapped[str]
    effective_from: Mapped[str] = mapped_column(index=True)
    enabled: Mapped[bool] = mapped_column(default=True, server_default="1")
    building_ids: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    point_ids: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    baseline_source: Mapped[str]
    fixed_baseline: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    thresholds: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    rate_threshold: Mapped[float | None]
    rate_level: Mapped[str] = mapped_column(default="orange", server_default="orange")
    persistence: Mapped[dict] = mapped_column(JSON)
    recovery: Mapped[dict] = mapped_column(JSON)
    environment: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    source: Mapped[str]
    confirmed_by: Mapped[str]
    note: Mapped[str] = mapped_column(default="", server_default="")


class AlarmEvent(DatasetRow, AuditFields, Base):
    __tablename__ = "events"
    __table_args__ = scoped(
        reference("points", "point_id"),
        reference("rule_definitions", "rule_id"),
        unique("event_no"),
        choices("status", "pending handling recovering closed"),
        choices("level", "yellow orange red"),
        choices("peak_level", "yellow orange red"),
        Index(
            "uq_active_event",
            "dataset_id",
            "point_id",
            "rule_id",
            unique=True,
            sqlite_where=text("status != 'closed'"),
        ),
    )
    event_no: Mapped[str]
    point_id: Mapped[str]
    rule_id: Mapped[str]
    rule_code: Mapped[str]
    level: Mapped[str]
    peak_level: Mapped[str]
    status: Mapped[str] = mapped_column(default="pending", server_default="pending")
    unit: Mapped[str]
    opened_at: Mapped[str]
    opened_by: Mapped[str]
    last_trigger_at: Mapped[str] = mapped_column(index=True)
    last_trigger_value: Mapped[float]
    evidences: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    superseded_evidences: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    upgrades: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    timeline: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    acknowledged_at: Mapped[str | None]
    acknowledged_by: Mapped[str] = mapped_column(default="", server_default="")
    closed_at: Mapped[str | None]
    closed_by: Mapped[str] = mapped_column(default="", server_default="")
    close_basis: Mapped[str] = mapped_column(default="", server_default="")
    note: Mapped[str] = mapped_column(default="", server_default="")


class AlarmNotification(DatasetRow, Base):
    __tablename__ = "notifications"
    __table_args__ = scoped(
        reference("events", "event_id"),
        choices("level", "yellow orange red"),
        CheckConstraint("due_minutes > 0"),
    )
    event_id: Mapped[str]
    event_no: Mapped[str]
    level: Mapped[str]
    target: Mapped[str]
    channel: Mapped[str]
    created_at: Mapped[str] = mapped_column(index=True)
    presented_at: Mapped[str | None]
    acknowledged_at: Mapped[str | None]
    acknowledged_by: Mapped[str] = mapped_column(default="", server_default="")
    due_minutes: Mapped[int]
    fallback: Mapped[str]
    escalated_at: Mapped[str | None]
    escalated_to: Mapped[str] = mapped_column(default="", server_default="")
    escalation_source: Mapped[str] = mapped_column(default="", server_default="")
