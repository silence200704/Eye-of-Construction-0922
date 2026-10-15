from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.http import install_http
from .core.security import TokenCodec
from .core.settings import Settings
from .db.database import Database
from .routers import auth, health


def create_app(settings: Settings | None = None) -> FastAPI:
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
    return app
