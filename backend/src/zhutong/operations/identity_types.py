from dataclasses import dataclass
from typing import Protocol

ROLES = {
    "safety": "学校安全管理人员",
    "property": "物业值班人员",
    "device": "设备管理人员",
    "inspector": "巡检人员",
    "repair": "维修人员",
}


@dataclass(frozen=True)
class Account:
    id: str
    name: str
    role: str
    enabled: bool
    is_demo: bool
    building_ids: list[str] | None

    def public(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "roleLabel": ROLES.get(self.role, self.role),
            "buildingIds": self.building_ids,
        }


@dataclass(frozen=True)
class SessionRecord:
    id: str
    user_id: str
    expires_at: int
    revoked: bool = False


class IdentityRepository(Protocol):
    def by_id(self, user_id: str) -> Account | None: ...
    def demo_accounts(self) -> list[Account]: ...
    def session(self, session_id: str) -> SessionRecord | None: ...
    def save_session(self, record: SessionRecord) -> None: ...
    def revoke_session(self, session_id: str) -> None: ...
