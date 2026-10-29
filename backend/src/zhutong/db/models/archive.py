from sqlalchemy import JSON, CheckConstraint, ForeignKeyConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from .common import ArchiveFields, AuditFields, DatasetRow, choices, reference, scoped, unique


class Building(DatasetRow, AuditFields, ArchiveFields, Base):
    __tablename__ = "buildings"
    __table_args__ = scoped(
        unique("code"), choices("status", "active archived"), choices("data_source", "real demo")
    )
    code: Mapped[str]
    name: Mapped[str]
    purpose: Mapped[str] = mapped_column(default="", server_default="")
    build_year: Mapped[int | None]
    floor_count: Mapped[int | None]
    area: Mapped[float | None]
    structure_type: Mapped[str] = mapped_column(default="", server_default="")
    manager_unit: Mapped[str] = mapped_column(default="", server_default="")
    user_unit: Mapped[str] = mapped_column(default="", server_default="")
    owner: Mapped[str] = mapped_column(default="", server_default="")
    owner_phone: Mapped[str] = mapped_column(default="", server_default="")
    backup_person: Mapped[str] = mapped_column(default="", server_default="")
    source: Mapped[str] = mapped_column(default="", server_default="")
    footprint: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    data_source: Mapped[str] = mapped_column(default="demo", server_default="demo")
    remark: Mapped[str] = mapped_column(default="", server_default="")


class Floor(DatasetRow, AuditFields, ArchiveFields, Base):
    __tablename__ = "floors"
    __table_args__ = scoped(
        reference("buildings", "building_id"),
        unique("building_id", "floor_no"),
        unique("id", "building_id"),
        choices("status", "active archived"),
        CheckConstraint("plan_version > 0"),
    )
    building_id: Mapped[str]
    floor_no: Mapped[int]
    name: Mapped[str]
    zones: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    plan_version: Mapped[int] = mapped_column(default=1, server_default="1")
    remark: Mapped[str] = mapped_column(default="", server_default="")


class Point(DatasetRow, AuditFields, ArchiveFields, Base):
    __tablename__ = "points"
    __table_args__ = scoped(
        reference("buildings", "building_id"),
        ForeignKeyConstraint(
            ["dataset_id", "floor_id", "building_id"],
            ["floors.dataset_id", "floors.id", "floors.building_id"],
        ),
        unique("code"),
        choices("status", "active archived"),
        choices("type", "crack tilt vibration temp_humidity manual_check"),
        choices("metric", "crack_width tilt_xy vibration temp_humidity inspection"),
        choices("data_source", "real demo"),
        CheckConstraint("x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1"),
        CheckConstraint("plan_version > 0"),
        Index(
            "uq_point_active_nfc",
            "dataset_id",
            "nfc_code",
            unique=True,
            sqlite_where=text("status='active' AND nfc_code IS NOT NULL"),
        ),
    )
    code: Mapped[str]
    name: Mapped[str]
    building_id: Mapped[str]
    floor_id: Mapped[str]
    zone_id: Mapped[str] = mapped_column(default="", server_default="")
    type: Mapped[str]
    metric: Mapped[str]
    x: Mapped[float]
    y: Mapped[float]
    nfc_code: Mapped[str | None]
    nfc: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    plan_version: Mapped[int] = mapped_column(default=1, server_default="1")
    location_history: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    owner: Mapped[str] = mapped_column(default="", server_default="")
    backup_person: Mapped[str] = mapped_column(default="", server_default="")
    install_date: Mapped[str] = mapped_column(default="", server_default="")
    data_source: Mapped[str] = mapped_column(default="demo", server_default="demo")
    remark: Mapped[str] = mapped_column(default="", server_default="")


class Device(DatasetRow, AuditFields, ArchiveFields, Base):
    __tablename__ = "devices"
    __table_args__ = scoped(
        reference("points", "point_id"),
        unique("code"),
        choices("status", "active archived"),
        choices("health", "unknown online offline"),
        CheckConstraint("range_min IS NULL OR range_max IS NULL OR range_min <= range_max"),
    )
    code: Mapped[str]
    name: Mapped[str]
    point_id: Mapped[str | None]
    model: Mapped[str] = mapped_column(default="", server_default="")
    serial: Mapped[str] = mapped_column(default="", server_default="")
    range_min: Mapped[float | None]
    range_max: Mapped[float | None]
    range_text: Mapped[str] = mapped_column(default="", server_default="")
    unit: Mapped[str] = mapped_column(default="", server_default="")
    node_id: Mapped[str] = mapped_column(default="", server_default="")
    gateway: Mapped[str] = mapped_column(default="", server_default="")
    mount_position: Mapped[str] = mapped_column(default="", server_default="")
    direction: Mapped[str] = mapped_column(default="", server_default="")
    install_date: Mapped[str] = mapped_column(default="", server_default="")
    calibrated_at: Mapped[str] = mapped_column(default="", server_default="")
    health: Mapped[str] = mapped_column(default="unknown", server_default="unknown")
    telemetry: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    remark: Mapped[str] = mapped_column(default="", server_default="")
