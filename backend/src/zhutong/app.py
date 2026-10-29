import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.http import install_http
from .core.security import TokenCodec
from .core.settings import Settings
from .db.database import Database
from .routers import auth, health, importing, media
from .routers.datasets import alarms, archive, common, monitoring
from .routers.datasets.assistant import api as assistant_api
from .routers.datasets.field import api as field_api
from .routers.datasets.field import reports_api
from .routers.datasets.knowledge import api as knowledge_api
from .routers.datasets.mobile import api as mobile_api


def create_app(settings: Settings | None = None) -> FastAPI:
    logging.basicConfig(level=logging.INFO)
    configured = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.database = Database(configured.database_url)
        app.state.codec = TokenCodec(configured)
        try:
            yield
        finally:
            app.state.database.close()

    app = FastAPI(title="筑瞳 API", version="0.1.0", lifespan=lifespan)
    app.state.settings = configured
    install_http(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=configured.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "X-Request-ID",
            "Idempotency-Key",
            "X-Dataset-ID",
        ],
        expose_headers=["X-Request-ID"],
    )
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(media.router)
    app.include_router(importing.router)
    app.include_router(common.router)
    app.include_router(archive.router)
    app.include_router(monitoring.router)
    app.include_router(alarms.router)
    app.include_router(field_api.router)
    app.include_router(reports_api.router)
    app.include_router(assistant_api.router)
    app.include_router(assistant_api.media_router)
    app.include_router(knowledge_api.router)
    app.include_router(mobile_api.router)
    return app
