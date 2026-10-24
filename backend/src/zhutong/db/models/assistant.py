"""小瞳会话持久化：按身份与数据集隔离，回答原文与引用随轮次保存。"""

from sqlalchemy import JSON, ForeignKeyConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class AssistantSession(Base):
    __tablename__ = "assistant_sessions"
    dataset_id: Mapped[str] = mapped_column(primary_key=True)
    id: Mapped[str] = mapped_column(primary_key=True)
    actor_id: Mapped[str] = mapped_column(index=True)
    epoch: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    title: Mapped[str] = mapped_column(default="")
    turn_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str]
    updated_at: Mapped[str]


class AssistantTurn(Base):
    __tablename__ = "assistant_turns"
    dataset_id: Mapped[str] = mapped_column(primary_key=True)
    id: Mapped[str] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(index=True)
    seq: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[str]
    question: Mapped[str] = mapped_column(String(500))
    answer: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str]
    __table_args__ = (
        ForeignKeyConstraint(
            ["dataset_id", "session_id"],
            ["assistant_sessions.dataset_id", "assistant_sessions.id"],
        ),
    )
