from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from zhutong.app import create_app
from zhutong.bootstrap import initialize
from zhutong.core.security import TokenCodec
from zhutong.core.settings import BACKEND_ROOT, Settings


def test_upgrade_removes_credentials_and_preserves_identity_sessions(settings: Settings) -> None:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    engine = create_engine(settings.database_url)
    token, expires = TokenCodec(settings).issue("demo-repair", "existing-session")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0001_identity")
        connection.execute(
            text(
                "INSERT INTO users (id,username,name,role,password_hash,enabled,is_demo) "
                "VALUES ('demo-repair','demo-repair','已有维修人员','repair','old-hash',1,1)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO login_sessions (id,user_id,expires_at,revoked) "
                "VALUES ('existing-session','demo-repair',:expires,0)"
            ),
            {"expires": expires},
        )
    initialize(settings)
    with engine.connect() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("users")}
        assert "username" not in columns
        assert "password_hash" not in columns
        assert connection.scalar(text("SELECT count(*) FROM users")) == 5
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
    with TestClient(create_app(settings)) as client:
        response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200
        assert response.json()["data"]["name"] == "已有维修人员"
    engine.dispose()
