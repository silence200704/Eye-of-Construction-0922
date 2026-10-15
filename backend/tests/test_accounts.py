import pytest
from conftest import demo_token
from fastapi.testclient import TestClient

from zhutong.app import create_app
from zhutong.core.settings import Settings


def test_demo_accounts_are_explicit_and_never_expose_passwords(client: TestClient) -> None:
    response = client.get("/api/v1/demo/accounts")
    assert response.status_code == 200
    accounts = response.json()["data"]
    assert {row["role"] for row in accounts} == {
        "safety",
        "property",
        "device",
        "inspector",
        "repair",
    }
    assert "password" not in response.text.lower()
    assert "hash" not in response.text.lower()


@pytest.mark.parametrize("role", ["safety", "property", "device", "inspector", "repair"])
def test_shortcut_login_returns_server_identity(client: TestClient, role: str) -> None:
    token = demo_token(client, f"demo-{role}")
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["data"]["role"] == role


def test_password_login_and_bad_password(client: TestClient) -> None:
    good = client.post(
        "/api/v1/auth/login", json={"username": "demo-safety", "password": "zhutong-demo"}
    )
    assert good.status_code == 200
    bad = client.post("/api/v1/auth/login", json={"username": "demo-safety", "password": "wrong"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "AUTH_REQUIRED"


def test_shortcut_cannot_invent_account_or_role(client: TestClient) -> None:
    missing = client.post("/api/v1/demo/login", json={"accountId": "invented-admin"})
    assert missing.status_code == 401
    forged = client.post(
        "/api/v1/demo/login", json={"accountId": "demo-inspector", "role": "safety"}
    )
    assert forged.status_code == 422


def test_demo_routes_are_disabled_outside_demo_mode(settings: Settings) -> None:
    settings.demo_mode = False
    with TestClient(create_app(settings)) as isolated:
        assert isolated.get("/api/v1/demo/accounts").status_code == 404
        assert (
            isolated.post("/api/v1/demo/login", json={"accountId": "demo-safety"}).status_code
            == 404
        )


@pytest.mark.parametrize("authorization", [None, "Bearer broken", "Basic unsafe"])
def test_missing_or_invalid_token_is_rejected(
    client: TestClient, authorization: str | None
) -> None:
    headers = {} if authorization is None else {"Authorization": authorization}
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["ok"] is False


def test_logout_revokes_the_server_session(client: TestClient) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
