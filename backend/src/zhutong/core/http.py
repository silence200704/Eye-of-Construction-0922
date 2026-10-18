import logging
import re
import time
import uuid
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from .errors import AppError

logger = logging.getLogger("zhutong.http")


def ok(
    request: Request,
    data: Any,
    rev: int | None = None,
    replayed: bool = False,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "ok": True,
        "data": data,
        "rev": rev,
        "replayed": replayed,
        "meta": {"requestId": request.state.request_id, **(meta or {})},
    }


def failure(request: Request, error: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status,
        content={
            "ok": False,
            "error": {
                "code": error.code,
                "message": str(error),
                "retryable": error.status >= 500,
                "details": error.details,
            },
            "meta": {"requestId": getattr(request.state, "request_id", uuid.uuid4().hex)},
        },
    )


def install_http(app: FastAPI) -> None:
    @app.middleware("http")
    async def trace(request: Request, call_next: Any) -> Any:
        candidate = request.headers.get("X-Request-ID", "")
        request.state.request_id = (
            candidate if re.fullmatch(r"[A-Za-z0-9_-]{8,64}", candidate) else uuid.uuid4().hex
        )
        started = time.monotonic()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        logger.info(
            "%s %s %s request=%s elapsed_ms=%.1f",
            request.method,
            request.url.path,
            response.status_code,
            request.state.request_id,
            (time.monotonic() - started) * 1000,
        )
        return response

    @app.exception_handler(AppError)
    async def application_error(request: Request, error: AppError) -> JSONResponse:
        return failure(request, error)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
        fields = [
            {"field": ".".join(map(str, e["loc"])), "message": e["msg"]} for e in error.errors()
        ]
        return failure(
            request, AppError("VALIDATION_FAILED", "请求字段校验未通过", 422, {"fields": fields})
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException) -> JSONResponse:
        code = "NOT_FOUND" if error.status_code == 404 else "HTTP_ERROR"
        return failure(request, AppError(code, str(error.detail), error.status_code))

    @app.exception_handler(Exception)
    async def unexpected(request: Request, error: Exception) -> JSONResponse:
        logger.error("Unexpected error request=%s", request.state.request_id, exc_info=error)
        return failure(request, AppError("INTERNAL", "服务暂不可用，请保留草稿后重试", 500))
