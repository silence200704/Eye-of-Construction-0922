from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def sqlite_pragmas(connection: Any, _: Any) -> None:
    cursor = connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


class Database:
    def __init__(self, url: str) -> None:
        parsed = make_url(url)
        if parsed.get_backend_name() != "sqlite":
            raise ValueError("首版仅支持 SQLite")
        if parsed.database and parsed.database != ":memory:":
            Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 5})
        event.listen(self.engine, "connect", sqlite_pragmas)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def close(self) -> None:
        self.engine.dispose()
