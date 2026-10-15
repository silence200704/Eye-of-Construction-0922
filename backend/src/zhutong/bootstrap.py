from pathlib import Path

from alembic import command
from alembic.config import Config

from .core.security import signing_key
from .core.settings import BACKEND_ROOT, Settings
from .db.database import Database
from .db.models import User
from .operations.identity_types import ROLES


def migrate(database: Database) -> None:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    with database.engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def seed_accounts(database: Database, settings: Settings) -> None:
    if not settings.demo_mode:
        return
    with database.sessions.begin() as session:
        for role, label in ROLES.items():
            user_id = f"demo-{role}"
            if session.get(User, user_id) is None:
                session.add(
                    User(
                        id=user_id,
                        name=f"演示{label}",
                        role=role,
                        enabled=True,
                        is_demo=True,
                    )
                )


def initialize(settings: Settings | None = None) -> None:
    configured = settings or Settings()
    Path(configured.runtime_dir).mkdir(parents=True, exist_ok=True)
    signing_key(configured)
    database = Database(configured.database_url)
    try:
        migrate(database)
        seed_accounts(database, configured)
    finally:
        database.close()
