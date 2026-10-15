import pytest
from conftest import demo_token
from fastapi.testclient import TestClient

from zhutong.app import create_app
from zhutong.core.settings import Settings


def test_demo_identities_are_explicit_without_credentials(client: TestClient) -> None:
    response = client.get("/api/v1/demo/identities")
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
    assert "username" not in response.text.lower()


@pytest.mark.parametrize("role", ["safety", "property", "device", "inspector", "repair"])
def test_switch_returns_server_identity(client: TestClient, role: str) -> None:
    token = demo_token(client, f"demo-{role}")
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json()["data"]["role"] == role


def test_password_login_is_removed(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/login", json={"username": "demo-safety", "password": "zhutong-demo"}
    )
    assert response.status_code == 404
    schema = client.get("/openapi.json").json()
    assert "LoginInput" not in schema["components"]["schemas"]


def test_shortcut_cannot_invent_account_or_role(client: TestClient) -> None:
    missing = client.post("/api/v1/demo/identity", json={"identityId": "invented-admin"})
    assert missing.status_code == 401
    forged = client.post(
        "/api/v1/demo/identity", json={"identityId": "demo-inspector", "role": "safety"}
    )
    assert forged.status_code == 422


def test_demo_routes_are_disabled_outside_demo_mode(settings: Settings) -> None:
    settings.demo_mode = False
    with TestClient(create_app(settings)) as isolated:
        assert isolated.get("/api/v1/demo/identities").status_code == 404
        assert (
            isolated.post("/api/v1/demo/identity", json={"identityId": "demo-safety"}).status_code
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
