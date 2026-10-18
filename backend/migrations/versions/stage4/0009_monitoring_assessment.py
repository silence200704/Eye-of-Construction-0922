"""阶段 4：记录保存规则版本与判定快照。"""

import sqlalchemy as sa
from alembic import op

revision = "0009_monitoring_assessment"
down_revision = "0008_legacy_revision"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("records", sa.Column("rule_id", sa.String(), nullable=True))
    op.add_column("records", sa.Column("rule_version", sa.String(), nullable=True))
    op.add_column("records", sa.Column("rule_snapshot", sa.JSON(), nullable=True))
    op.add_column("records", sa.Column("assessment", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("records", "assessment")
    op.drop_column("records", "rule_snapshot")
    op.drop_column("records", "rule_version")
    op.drop_column("records", "rule_id")
