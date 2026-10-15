import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import insert, inspect, select, text
from sqlalchemy.exc import IntegrityError

from zhutong.core.settings import BACKEND_ROOT
from zhutong.db.database import Database
from zhutong.db.models.archive import Building, Floor, Point
from zhutong.db.models.monitoring import Baseline


def test_all_legacy_and_runtime_entities_have_migrated_tables(database: Database) -> None:
    expected = {
        "datasets",
        "buildings",
        "floors",
        "points",
        "devices",
        "baselines",
        "records",
        "audits",
        "rule_definitions",
        "rules",
        "events",
        "notifications",
        "plans",
        "tasks",
        "issues",
        "work_orders",
        "attachments",
        "maintenance_plans",
        "maintenance_tasks",
        "media_files",
        "media_frames",
        "media_videos",
        "media_comparisons",
        "operation_receipts",
        "preferences",
        "session_states",
        "import_batches",
    }
    assert expected <= set(inspect(database.engine).get_table_names())
    with database.engine.connect() as connection:
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
        assert connection.scalar(text("SELECT epoch FROM datasets WHERE id='demo-main'")) == 1


def test_same_legacy_id_is_isolated_between_datasets(database: Database) -> None:
    with database.sessions.begin() as session:
        session.execute(
            insert(Building),
            {"dataset_id": "demo-showcase", "id": "b1", "code": "B01", "name": "另一测试集"},
        )
    with database.sessions() as session:
        assert len(session.scalars(select(Building).where(Building.id == "b1")).all()) == 2
    with pytest.raises(IntegrityError), database.sessions.begin() as session:
        session.execute(
            insert(Floor),
            {
                "dataset_id": "demo-showcase",
                "id": "bad-floor",
                "building_id": "only-in-main",
                "floor_no": 1,
                "name": "无效关联",
            },
        )


@pytest.mark.parametrize(
    "changes", [{"x": 1.1}, {"revision": 0}, {"status": "invented"}, {"floor_id": "missing"}]
)
def test_bad_point_rows_are_rejected_atomically(database: Database, changes: dict) -> None:
    values = {
        "dataset_id": "demo-main",
        "id": "bad",
        "code": "BAD",
        "name": "坏点",
        "building_id": "b1",
        "floor_id": "f1",
        "type": "crack",
        "metric": "crack_width",
        "x": 0.5,
        "y": 0.5,
        **changes,
    }
    with pytest.raises(IntegrityError), database.sessions.begin() as session:
        session.execute(
            insert(Building),
            {"dataset_id": "demo-main", "id": "rollback", "code": "ROLLBACK", "name": "必须回滚"},
        )
        session.execute(insert(Point), values)
    with database.sessions() as session:
        assert session.get(Building, ("demo-main", "rollback")) is None


def test_point_floor_must_belong_to_its_building(database: Database) -> None:
    with database.sessions.begin() as session:
        session.execute(
            insert(Building),
            {"dataset_id": "demo-main", "id": "b2", "code": "B02", "name": "二楼栋"},
        )
    with pytest.raises(IntegrityError), database.sessions.begin() as session:
        session.execute(
            insert(Point),
            {
                "dataset_id": "demo-main",
                "id": "wrong",
                "code": "WRONG",
                "name": "错楼",
                "building_id": "b2",
                "floor_id": "f1",
                "type": "crack",
                "metric": "crack_width",
                "x": 0.5,
                "y": 0.5,
            },
        )


def test_only_one_current_baseline_and_unique_versions(database: Database) -> None:
    values = {
        "dataset_id": "demo-main",
        "id": "base1",
        "point_id": "p1",
        "metric": "crack_width",
        "version": 1,
        "current": True,
        "effective_from": "2026-10-01T00:00:00+08:00",
        "values": {"width": 0.5},
        "unit": "mm",
    }
    with database.sessions.begin() as session:
        session.execute(insert(Baseline), values)
    for changes in [{"version": 2}, {"current": False}]:
        with pytest.raises(IntegrityError), database.sessions.begin() as session:
            session.execute(insert(Baseline), {**values, "id": "base2", **changes})


def test_migrations_match_models_and_can_roll_back_stage2(database: Database) -> None:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "migrations"))
    with database.engine.begin() as connection:
        config.attributes["connection"] = connection
        command.check(config)
        command.downgrade(config, "0002_identity_only")
        assert "users" in inspect(connection).get_table_names()
        assert "media_files" not in inspect(connection).get_table_names()
        command.upgrade(config, "head")
        command.check(config)
