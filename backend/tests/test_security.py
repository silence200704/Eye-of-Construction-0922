import time

import jwt
from conftest import demo_token
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from zhutong.core.settings import Settings


def test_disabled_account_cannot_use_existing_token(client: TestClient, settings: Settings) -> None:
    token = demo_token(client)
    with create_engine(settings.database_url).begin() as connection:
        connection.execute(text("UPDATE users SET enabled=0 WHERE id='demo-safety'"))
    assert (
        client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code
        == 401
    )


def test_expired_and_tampered_tokens_fail(client: TestClient, settings: Settings) -> None:
    token = demo_token(client)
    claims = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
    claims["exp"] = int(time.time()) - 10
    expired = jwt.encode(claims, settings.secret_key, algorithm="HS256")
    forged = jwt.encode(claims, "different-key-with-at-least-32-characters", algorithm="HS256")
    for invalid in [expired, forged]:
        assert (
            client.get(
                "/api/v1/auth/me", headers={"Authorization": f"Bearer {invalid}"}
            ).status_code
            == 401
        )


def test_current_role_is_read_from_database(client: TestClient, settings: Settings) -> None:
    token = demo_token(client)
    with create_engine(settings.database_url).begin() as connection:
        connection.execute(text("UPDATE users SET role='inspector' WHERE id='demo-safety'"))
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.json()["data"]["role"] == "inspector"
