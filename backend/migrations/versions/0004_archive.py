"""Stage 2: archive frozen schema."""

import sqlalchemy as sa
from alembic import op

revision = "0004_archive"
down_revision = "0003_foundation"
branch_labels = None
depends_on = None


def _create_buildings() -> None:
    op.create_table(
        "buildings",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("purpose", sa.String(), server_default="", nullable=False),
        sa.Column("build_year", sa.Integer(), nullable=True),
        sa.Column("floor_count", sa.Integer(), nullable=True),
        sa.Column("area", sa.Double(), nullable=True),
        sa.Column("structure_type", sa.String(), server_default="", nullable=False),
        sa.Column("manager_unit", sa.String(), server_default="", nullable=False),
        sa.Column("user_unit", sa.String(), server_default="", nullable=False),
        sa.Column("owner", sa.String(), server_default="", nullable=False),
        sa.Column("owner_phone", sa.String(), server_default="", nullable=False),
        sa.Column("backup_person", sa.String(), server_default="", nullable=False),
        sa.Column("source", sa.String(), server_default="", nullable=False),
        sa.Column("footprint", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("data_source", sa.String(), server_default="demo", nullable=False),
        sa.Column("remark", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.Column("status", sa.String(), server_default="active", nullable=False),
        sa.Column("archive_reason", sa.String(), server_default="", nullable=False),
        sa.Column("archived_at", sa.String(), nullable=True),
        sa.Column("archived_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("data_source IN ('real','demo')"),
        sa.CheckConstraint("status IN ('active','archived')"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "code"),
    )


def _create_floors() -> None:
    op.create_table(
        "floors",
        sa.Column("building_id", sa.String(), nullable=False),
        sa.Column("floor_no", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("zones", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("plan_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("remark", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.Column("status", sa.String(), server_default="active", nullable=False),
        sa.Column("archive_reason", sa.String(), server_default="", nullable=False),
        sa.Column("archived_at", sa.String(), nullable=True),
        sa.Column("archived_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("status IN ('active','archived')"),
        sa.CheckConstraint("plan_version > 0"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "building_id"],
            ["buildings.dataset_id", "buildings.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "building_id", "floor_no"),
        sa.UniqueConstraint("dataset_id", "id", "building_id"),
    )


def _create_points() -> None:
    op.create_table(
        "points",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("building_id", sa.String(), nullable=False),
        sa.Column("floor_id", sa.String(), nullable=False),
        sa.Column("zone_id", sa.String(), server_default="", nullable=False),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("metric", sa.String(), nullable=False),
        sa.Column("x", sa.Double(), nullable=False),
        sa.Column("y", sa.Double(), nullable=False),
        sa.Column("nfc_code", sa.String(), nullable=True),
        sa.Column("nfc", sa.JSON(), nullable=True),
        sa.Column("plan_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("location_history", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("owner", sa.String(), server_default="", nullable=False),
        sa.Column("backup_person", sa.String(), server_default="", nullable=False),
        sa.Column("install_date", sa.String(), server_default="", nullable=False),
        sa.Column("data_source", sa.String(), server_default="demo", nullable=False),
        sa.Column("remark", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.Column("status", sa.String(), server_default="active", nullable=False),
        sa.Column("archive_reason", sa.String(), server_default="", nullable=False),
        sa.Column("archived_at", sa.String(), nullable=True),
        sa.Column("archived_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("data_source IN ('real','demo')"),
        sa.CheckConstraint(
            "metric IN ('crack_width','tilt_xy','vibration','temp_humidity','inspection')"
        ),
        sa.CheckConstraint("status IN ('active','archived')"),
        sa.CheckConstraint("type IN ('crack','tilt','vibration','temp_humidity','manual_check')"),
        sa.CheckConstraint("plan_version > 0"),
        sa.CheckConstraint("revision > 0"),
        sa.CheckConstraint("x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "building_id"],
            ["buildings.dataset_id", "buildings.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id", "floor_id", "building_id"],
            ["floors.dataset_id", "floors.id", "floors.building_id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "code"),
    )
    op.create_index(
        "uq_point_active_nfc",
        "points",
        ["dataset_id", "nfc_code"],
        unique=True,
        sqlite_where=sa.text("status='active' AND nfc_code IS NOT NULL"),
    )


def _create_devices() -> None:
    op.create_table(
        "devices",
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("point_id", sa.String(), nullable=True),
        sa.Column("model", sa.String(), server_default="", nullable=False),
        sa.Column("serial", sa.String(), server_default="", nullable=False),
        sa.Column("range_min", sa.Double(), nullable=True),
        sa.Column("range_max", sa.Double(), nullable=True),
        sa.Column("range_text", sa.String(), server_default="", nullable=False),
        sa.Column("unit", sa.String(), server_default="", nullable=False),
        sa.Column("node_id", sa.String(), server_default="", nullable=False),
        sa.Column("gateway", sa.String(), server_default="", nullable=False),
        sa.Column("mount_position", sa.String(), server_default="", nullable=False),
        sa.Column("direction", sa.String(), server_default="", nullable=False),
        sa.Column("install_date", sa.String(), server_default="", nullable=False),
        sa.Column("calibrated_at", sa.String(), server_default="", nullable=False),
        sa.Column("health", sa.String(), server_default="unknown", nullable=False),
        sa.Column("remark", sa.String(), server_default="", nullable=False),
        sa.Column("dataset_id", sa.String(length=80), nullable=False),
        sa.Column("id", sa.String(length=160), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
        sa.Column("legacy_payload", sa.JSON(), server_default="{}", nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), server_default="", nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("updated_by", sa.String(), server_default="", nullable=False),
        sa.Column("status", sa.String(), server_default="active", nullable=False),
        sa.Column("archive_reason", sa.String(), server_default="", nullable=False),
        sa.Column("archived_at", sa.String(), nullable=True),
        sa.Column("archived_by", sa.String(), server_default="", nullable=False),
        sa.CheckConstraint("health IN ('unknown','online','offline')"),
        sa.CheckConstraint("status IN ('active','archived')"),
        sa.CheckConstraint("range_min IS NULL OR range_max IS NULL OR range_min <= range_max"),
        sa.CheckConstraint("revision > 0"),
        sa.ForeignKeyConstraint(
            ["dataset_id", "point_id"],
            ["points.dataset_id", "points.id"],
        ),
        sa.ForeignKeyConstraint(
            ["dataset_id"],
            ["datasets.id"],
        ),
        sa.PrimaryKeyConstraint("dataset_id", "id"),
        sa.UniqueConstraint("dataset_id", "code"),
    )


def upgrade() -> None:
    _create_buildings()
    _create_floors()
    _create_points()
    _create_devices()
    # ### end Alembic commands ###


def downgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.drop_table("devices")
    op.drop_index(
        "uq_point_active_nfc",
        table_name="points",
        sqlite_where=sa.text("status='active' AND nfc_code IS NOT NULL"),
    )
    op.drop_table("points")
    op.drop_table("floors")
    op.drop_table("buildings")
    # ### end Alembic commands ###
