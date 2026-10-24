"""阶段 7 返修：会话绑定数据集 epoch；旧会话默认失效。"""

import sqlalchemy as sa
from alembic import op

revision = "0013_assistant_session_epoch"
down_revision = "0012_assistant_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assistant_sessions",
        sa.Column("epoch", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("assistant_sessions", "epoch")
