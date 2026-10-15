import time
import uuid

from ..core.errors import AppError, unauthorized
from ..core.security import TokenCodec, passwords
from .identity_types import Account, IdentityRepository, SessionRecord


class AuthService:
    def __init__(self, repository: IdentityRepository, codec: TokenCodec, demo_mode: bool) -> None:
        self.repository = repository
        self.codec = codec
        self.demo_mode = demo_mode

    def list_demo(self) -> list[dict]:
        self.require_demo()
        return [account.public() for account in self.repository.demo_accounts()]

    def require_demo(self) -> None:
        if not self.demo_mode:
            raise AppError("NOT_FOUND", "演示快捷登录未启用", 404)

    def shortcut(self, account_id: str) -> dict:
        self.require_demo()
        account = self.repository.by_id(account_id)
        if account is None or not account.enabled or not account.is_demo:
            raise unauthorized()
        return self.issue(account)

    def login(self, username: str, password: str) -> dict:
        account = self.repository.by_username(username)
        if account is None or not account.enabled:
            raise unauthorized()
        if not passwords.verify(password, account.password_hash):
            raise unauthorized()
        return self.issue(account)

    def issue(self, account: Account) -> dict:
        session_id = uuid.uuid4().hex
        token, expires = self.codec.issue(account.id, session_id)
        self.repository.save_session(SessionRecord(session_id, account.id, expires))
        return {
            "accessToken": token, "tokenType": "bearer", "expiresAt": expires,
            "user": account.public(),
        }

    def principal(self, token: str) -> Account:
        claims = self.codec.decode(token)
        record = self.repository.session(claims["sid"])
        account = self.repository.by_id(claims["sub"])
        if (
            record is None or record.revoked or record.expires_at <= time.time()
            or record.user_id != claims["sub"] or account is None or not account.enabled
        ):
            raise unauthorized()
        return account

    def logout(self, token: str) -> None:
        self.principal(token)
        self.repository.revoke_session(self.codec.decode(token)["sid"])
