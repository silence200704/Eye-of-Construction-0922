import secrets
import time
from pathlib import Path
from typing import Any

import jwt

from .errors import unauthorized
from .settings import Settings


def signing_key(settings: Settings) -> str:
    if settings.secret_key:
        return settings.secret_key
    settings.runtime_dir.mkdir(parents=True, exist_ok=True)
    path = settings.runtime_dir / "session.key"
    try:
        with path.open("x", encoding="utf-8") as target:
            target.write(secrets.token_urlsafe(48))
    except FileExistsError:
        pass
    key = Path(path).read_text(encoding="utf-8").strip()
    if len(key) < 32:
        raise ValueError("本地签名密钥无效，请恢复 session.key 或配置 ZHUTONG_SECRET_KEY")
    return key


class TokenCodec:
    def __init__(self, settings: Settings) -> None:
        self.key = signing_key(settings)
        self.ttl = settings.session_ttl_seconds

    def issue(self, user_id: str, session_id: str) -> tuple[str, int]:
        expires = int(time.time()) + self.ttl
        payload = {"sub": user_id, "sid": session_id, "exp": expires, "iat": int(time.time())}
        return jwt.encode(payload, self.key, algorithm="HS256"), expires

    def decode(self, token: str) -> dict[str, Any]:
        try:
            result = jwt.decode(
                token, self.key, algorithms=["HS256"], options={"require": ["sub", "sid", "exp"]}
            )
        except jwt.InvalidTokenError as error:
            raise unauthorized() from error
        if not isinstance(result.get("sub"), str) or not isinstance(result.get("sid"), str):
            raise unauthorized()
        return result
