FROM ghcr.io/astral-sh/uv:0.11.7 AS uv
FROM python:3.12.13-slim
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY migrations ./migrations
COPY alembic.ini ./
RUN uv sync --frozen --no-dev && useradd --uid 10001 --create-home zhutong \
    && mkdir /data && chown -R zhutong:zhutong /data /app
USER 10001
ENV ZHUTONG_RUNTIME_DIR=/data ZHUTONG_DATABASE_URL=sqlite:////data/zhutong.sqlite
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "zhutong.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
