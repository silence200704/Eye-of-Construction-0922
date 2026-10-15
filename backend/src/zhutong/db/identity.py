import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..operations.identity_types import Account, SessionRecord
from .models import LoginSession, User


def account_of(row: User | None) -> Account | None:
    if row is None:
        return None
    return Account(
        id=row.id,
        name=row.name,
        role=row.role,
        enabled=row.enabled,
        is_demo=row.is_demo,
        building_ids=json.loads(row.building_ids_json) if row.building_ids_json else None,
    )


class SqlIdentityRepository:
    def __init__(self, session: Session) -> None:
        self.db = session

    def by_id(self, user_id: str) -> Account | None:
        return account_of(self.db.get(User, user_id))

    def demo_accounts(self) -> list[Account]:
        rows = self.db.scalars(select(User).where(User.enabled.is_(True), User.is_demo.is_(True)))
        return [account for row in rows if (account := account_of(row)) is not None]

    def session(self, session_id: str) -> SessionRecord | None:
        row = self.db.get(LoginSession, session_id)
        return (
            None if row is None else SessionRecord(row.id, row.user_id, row.expires_at, row.revoked)
        )

    def save_session(self, record: SessionRecord) -> None:
        self.db.add(
            LoginSession(
                id=record.id, user_id=record.user_id, expires_at=record.expires_at, revoked=False
            )
        )
        self.db.commit()

    def revoke_session(self, session_id: str) -> None:
        row = self.db.get(LoginSession, session_id)
        if row is not None:
            row.revoked = True
            self.db.commit()
