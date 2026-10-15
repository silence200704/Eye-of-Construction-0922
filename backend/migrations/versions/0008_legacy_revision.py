"""保留从零开始的原监测记录修订次数。"""

import sqlalchemy as sa
from alembic import op

revision = "0008_legacy_revision"
down_revision = "0007_media"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "records", sa.Column("record_revision", sa.Integer(), nullable=False, server_default="0")
    )


def downgrade() -> None:
    op.drop_column("records", "record_revision")
