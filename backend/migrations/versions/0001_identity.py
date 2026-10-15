"""真实账号与可撤销登录会话。"""

import sqlalchemy as sa
from alembic import op

revision = "0001_identity"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("username", sa.String(80), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("role", sa.String(40), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("is_demo", sa.Boolean(), nullable=False),
        sa.Column("building_ids_json", sa.Text(), nullable=True),
    )
    op.create_table(
        "login_sessions",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("user_id", sa.String(80), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_login_sessions_user_id", "login_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_table("login_sessions")
    op.drop_table("users")
