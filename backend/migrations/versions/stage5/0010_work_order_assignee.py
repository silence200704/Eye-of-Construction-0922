"""阶段 5 返修：工单派工与接单按稳定身份 ID 授权。"""

import sqlalchemy as sa
from alembic import op

revision = "0010_work_order_assignee"
down_revision = "0009_monitoring_assessment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_orders",
        sa.Column("assignee_id", sa.String(), nullable=False, server_default=""),
    )
    op.add_column(
        "work_orders", sa.Column("accepted_by_id", sa.String(), nullable=False, server_default="")
    )


def downgrade() -> None:
    op.drop_column("work_orders", "accepted_by_id")
    op.drop_column("work_orders", "assignee_id")
