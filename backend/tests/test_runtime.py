from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from zhutong.app import create_app
from zhutong.bootstrap import initialize
from zhutong.core.settings import Settings


def test_health_and_request_identifier(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready", headers={"X-Request-ID": "test-request-1234"})
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "ready"
    assert response.json()["meta"]["requestId"] == "test-request-1234"
    assert response.headers["X-Request-ID"] == "test-request-1234"


def test_initialize_is_repeatable_and_keeps_accounts(settings: Settings) -> None:
    initialize(settings)
    initialize(settings)
    with create_engine(settings.database_url).connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM users")) == 5
        assert connection.scalar(text("SELECT version_num FROM alembic_version"))


def test_uninitialized_database_is_not_ready(tmp_path: Path) -> None:
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'empty.sqlite').as_posix()}",
        runtime_dir=tmp_path,
        secret_key="test-only-key",
    )
    with TestClient(create_app(settings)) as connection:
        assert connection.get("/api/v1/health/live").status_code == 200
        response = connection.get("/api/v1/health/ready")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "STORAGE_UNAVAILABLE"


def test_validation_and_not_found_use_one_envelope(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"username": "demo-safety"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_FAILED"
    assert response.json()["meta"]["requestId"]
    assert client.get("/api/v1/not-a-route").json()["error"]["code"] == "NOT_FOUND"


def test_persisted_signing_key_and_sessions_survive_restart(settings: Settings) -> None:
    settings.secret_key = ""
    initialize(settings)
    with TestClient(create_app(settings)) as first:
        token = first.post(
            "/api/v1/demo/login", json={"accountId": "demo-safety"}
        ).json()["data"]["accessToken"]
    with TestClient(create_app(settings)) as second:
        assert second.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
        ).status_code == 200
