"""阶段 6：固定 DDL 快照，不依赖未来 ORM 定义。"""

import sqlalchemy as sa
from alembic import op

revision = "0011_local_knowledge"
down_revision = "0010_work_order_assignee"
branch_labels = None
depends_on = None


def create_0():
    op.create_table(
        "knowledge_documents",
        sa.Column("id", sa.String(), nullable=False, primary_key=True),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("source_path", sa.String(), nullable=False),
        sa.Column("source_kind", sa.String(), nullable=False),
        sa.Column("roles", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )


def create_1():
    op.create_table(
        "knowledge_versions",
        sa.Column("document_id", sa.String(), nullable=False, primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("created_by", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["knowledge_documents.id"]),
    )


def create_2():
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.String(), nullable=False, primary_key=True),
        sa.Column("document_id", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("heading", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("line_start", sa.Integer(), nullable=False),
        sa.Column("line_end", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id", "version"],
            ["knowledge_versions.document_id", "knowledge_versions.version"],
        ),
    )


def create_3():
    op.create_table(
        "knowledge_faqs",
        sa.Column("id", sa.String(), nullable=False, primary_key=True),
        sa.Column("chunk_id", sa.String(), nullable=False),
        sa.Column("questions", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["chunk_id"], ["knowledge_chunks.id"]),
    )


def create_4():
    op.create_table(
        "knowledge_synonyms",
        sa.Column("id", sa.String(), nullable=False, primary_key=True),
        sa.Column("canonical", sa.String(), nullable=False),
        sa.Column("aliases", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.UniqueConstraint(["canonical"][0]),
    )


def create_5():
    op.create_table(
        "knowledge_indexes",
        sa.Column("id", sa.String(), nullable=False, primary_key=True),
        sa.Column("model_id", sa.String(), nullable=False),
        sa.Column("model_revision", sa.String(), nullable=False),
        sa.Column("manifest_hash", sa.String(), nullable=False),
        sa.Column("dimension", sa.Integer(), nullable=False),
        sa.Column("corpus_hash", sa.String(), nullable=False),
        sa.Column("vector_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )


def create_6():
    op.create_table(
        "knowledge_vectors",
        sa.Column("index_id", sa.String(), nullable=False, primary_key=True),
        sa.Column("chunk_id", sa.String(), nullable=False, primary_key=True),
        sa.Column("embedding", sa.LargeBinary(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["index_id"], ["knowledge_indexes.id"]),
        sa.ForeignKeyConstraint(["chunk_id"], ["knowledge_chunks.id"]),
    )


def create_7():
    op.create_table(
        "knowledge_state",
        sa.Column("id", sa.Integer(), nullable=False, primary_key=True),
        sa.Column("active_index_id", sa.String(), nullable=True),
        sa.Column("last_error", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["active_index_id"], ["knowledge_indexes.id"]),
    )


def upgrade():
    create_0()
    create_1()
    create_2()
    create_3()
    create_4()
    create_5()
    create_6()
    create_7()


def downgrade():
    op.drop_table("knowledge_state")
    op.drop_table("knowledge_vectors")
    op.drop_table("knowledge_indexes")
    op.drop_table("knowledge_synonyms")
    op.drop_table("knowledge_faqs")
    op.drop_table("knowledge_chunks")
    op.drop_table("knowledge_versions")
    op.drop_table("knowledge_documents")
