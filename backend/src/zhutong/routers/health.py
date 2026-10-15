from fastapi import APIRouter, Request
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from ..core.errors import AppError
from ..core.http import ok

router = APIRouter(prefix="/api/v1/health", tags=["环境"])


@router.get("/live")
def live(request: Request) -> dict:
    return ok(
        request,
        {"status": "alive", "mode": "demo" if request.app.state.settings.demo_mode else "standard"},
    )


@router.get("/ready")
def ready(request: Request) -> dict:
    try:
        with request.app.state.database.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            if not inspect(connection).has_table("users"):
                raise AppError("STORAGE_UNAVAILABLE", "数据库尚未初始化，请先执行初始化命令", 503)
    except SQLAlchemyError as error:
        raise AppError("STORAGE_UNAVAILABLE", "数据库暂不可用", 503) from error
    return ok(request, {"status": "ready", "database": "sqlite"})
