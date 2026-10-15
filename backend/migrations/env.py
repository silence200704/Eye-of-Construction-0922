from alembic import context

from zhutong.core.settings import Settings
from zhutong.db import models  # noqa: F401
from zhutong.db.database import Base, Database


def run(connection: object) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    context.configure(
        url=Settings().database_url,
        target_metadata=Base.metadata,
        literal_binds=True,
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()
elif supplied := context.config.attributes.get("connection"):
    run(supplied)
else:
    database = Database(Settings().database_url)
    try:
        with database.engine.connect() as connection:
            run(connection)
    finally:
        database.close()
