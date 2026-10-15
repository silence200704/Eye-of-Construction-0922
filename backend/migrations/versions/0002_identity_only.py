"""演示仅切换身份，移除账号和密码；保留已有身份及会话。"""

import sqlalchemy as sa
from alembic import op

revision = "0002_identity_only"
down_revision = "0001_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite 重建父表时暂存子表，避免启用外键的数据库拒绝 DROP users。
    op.create_table(
        "_saved_identity_sessions",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("user_id", sa.String(80), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
    )
    op.execute("INSERT INTO _saved_identity_sessions SELECT * FROM login_sessions")
    op.drop_table("login_sessions")
    with op.batch_alter_table("users", recreate="always") as batch:
        batch.drop_column("username")
        batch.drop_column("password_hash")
    op.create_table(
        "login_sessions",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("user_id", sa.String(80), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("expires_at", sa.Integer(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_login_sessions_user_id", "login_sessions", ["user_id"])
    op.execute("INSERT INTO login_sessions SELECT * FROM _saved_identity_sessions")
    op.drop_table("_saved_identity_sessions")


def downgrade() -> None:
    raise RuntimeError("密码数据已移除，无法恢复旧凭据；回退请还原升级前的数据库备份")
