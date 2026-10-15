from typing import Any


class AppError(Exception):
    def __init__(
        self, code: str, message: str, status: int = 400, details: dict[str, Any] | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details or {}


def unauthorized() -> AppError:
    return AppError("AUTH_REQUIRED", "账号、密码或登录状态无效，请重新登录", 401)
