"""阶段 7：小瞳会话与轮次持久化。"""

import sqlalchemy as sa
from alembic import op

revision = "0012_assistant_sessions"
down_revision = "0011_local_knowledge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_sessions",
        sa.Column("dataset_id", sa.String(), nullable=False, primary_key=True),
        sa.Column("id", sa.String(), nullable=False, primary_key=True),
        sa.Column("actor_id", sa.String(), nullable=False, index=True),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("turn_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )
    op.create_table(
        "assistant_turns",
        sa.Column("dataset_id", sa.String(), nullable=False, primary_key=True),
        sa.Column("id", sa.String(), nullable=False, primary_key=True),
        sa.Column("session_id", sa.String(), nullable=False, index=True),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("actor_id", sa.String(), nullable=False),
        sa.Column("question", sa.String(500), nullable=False),
        sa.Column("answer", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["dataset_id", "session_id"],
            ["assistant_sessions.dataset_id", "assistant_sessions.id"],
        ),
    )


def downgrade() -> None:
    op.drop_table("assistant_turns")
    op.drop_table("assistant_sessions")
