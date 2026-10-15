from collections.abc import Iterator

import pytest
from sqlalchemy import insert

from zhutong.bootstrap import initialize
from zhutong.core.settings import Settings
from zhutong.db.database import Database
from zhutong.db.models.archive import Building, Floor, Point
from zhutong.db.models.field import Issue


@pytest.fixture
def database(settings: Settings) -> Iterator[Database]:
    initialize(settings)
    database = Database(settings.database_url)
    with database.sessions.begin() as session:
        session.execute(insert(Building), {"dataset_id": "demo-main", "id": "b1", "code": "B01", "name": "测试楼"})
        session.execute(insert(Floor), {"dataset_id": "demo-main", "id": "f1", "building_id": "b1", "floor_no": 1, "name": "一层"})
        session.execute(insert(Point), {"dataset_id": "demo-main", "id": "p1", "code": "P01", "name": "测试点", "building_id": "b1", "floor_id": "f1", "type": "crack", "metric": "crack_width", "x": 0.3, "y": 0.4})
        session.execute(insert(Issue), {"dataset_id": "demo-main", "id": "i1", "issue_no": "I01", "source": "report", "submission_key": "s1", "point_id": "p1", "building_id": "b1", "floor_id": "f1", "description": "测试问题"})
    yield database
    database.close()
