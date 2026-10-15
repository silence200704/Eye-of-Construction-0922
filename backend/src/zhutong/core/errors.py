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
    return AppError("AUTH_REQUIRED", "当前演示身份已失效，请重新连接或切换身份", 401)
