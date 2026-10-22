"""阶段 6：文档、不可变版本与原文块、FAQ/同义词、本地向量索引。"""

from alembic import op

from zhutong.db.models.knowledge import (
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeFAQ,
    KnowledgeIndex,
    KnowledgeState,
    KnowledgeSynonym,
    KnowledgeVector,
    KnowledgeVersion,
)

revision = "0011_local_knowledge"
down_revision = "0010_work_order_assignee"
branch_labels = None
depends_on = None
TABLES = [
    KnowledgeDocument,
    KnowledgeVersion,
    KnowledgeChunk,
    KnowledgeFAQ,
    KnowledgeSynonym,
    KnowledgeIndex,
    KnowledgeVector,
    KnowledgeState,
]


def upgrade() -> None:
    for model in TABLES:
        model.__table__.create(op.get_bind())


def downgrade() -> None:
    for model in reversed(TABLES):
        model.__table__.drop(op.get_bind())
