"""Persist explicitly simulated connection, battery and last-report metadata."""

import sqlalchemy as sa
from alembic import op

revision = "0014_device_telemetry"
down_revision = "0013_assistant_session_epoch"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("telemetry", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("devices", "telemetry")
