from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from zhutong.app import create_app
from zhutong.bootstrap import initialize
from zhutong.core.settings import Settings


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{(tmp_path / 'test.sqlite').as_posix()}",
        runtime_dir=tmp_path,
        secret_key="test-only-signing-key-do-not-use-outside-tests",
        demo_mode=True,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    initialize(settings)
    with TestClient(create_app(settings)) as connection:
        yield connection


def demo_token(client: TestClient, account: str = "demo-safety") -> str:
    response = client.post("/api/v1/demo/login", json={"accountId": account})
    assert response.status_code == 200, response.text
    return response.json()["data"]["accessToken"]
