"""阶段 4 后端测试的公共夹具：通过真实接口建档，不直接写业务表。"""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from zhutong.db.models import User
from zhutong.operations.identity_types import ROLES

DATASET = "demo-main"


def iso(minutes: float = 0) -> str:
    return (datetime.now(UTC) + timedelta(minutes=minutes)).isoformat()


def token_of(client: TestClient, account: str = "demo-safety") -> str:
    response = client.post("/api/v1/demo/identity", json={"identityId": account})
    assert response.status_code == 200, response.text
    return response.json()["data"]["accessToken"]


class Api:
    def __init__(self, client: TestClient, database_url: str, account: str = "demo-safety") -> None:
        self.client = client
        self.database_url = database_url
        self.token = token_of(client, account)
        state = client.get(f"/api/v1/datasets/{DATASET}/state", headers=self.auth())
        assert state.status_code == 200, state.text
        self.epoch = state.json()["data"]["epoch"]
        self.seq = 0

    def auth(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    def headers(self, key: str | None = None, epoch: int | None = None) -> dict:
        self.seq += 1
        return {
            **self.auth(),
            "Idempotency-Key": key or f"test-{self.seq}",
            "X-Dataset-Epoch": str(self.epoch if epoch is None else epoch),
        }

    def get(self, path: str, **params) -> dict:
        response = self.client.get(
            f"/api/v1/datasets/{DATASET}{path}", headers=self.auth(), params=params
        )
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def post(self, path: str, body: dict | None = None, key: str | None = None, **kwargs):
        return self.client.post(
            f"/api/v1/datasets/{DATASET}{path}",
            json=body or {},
            headers=self.headers(key, kwargs.get("epoch")),
        )

    def patch(self, path: str, body: dict) -> dict:
        response = self.client.patch(
            f"/api/v1/datasets/{DATASET}{path}", json=body, headers=self.headers()
        )
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def ok(self, response, status: int = 200) -> dict:
        assert response.status_code == status, response.text
        return response.json()["data"]

    def add_scoped_user(self, user_id: str, building_ids: list[str]) -> str:
        engine = create_engine(self.database_url)
        with Session(engine) as session:
            session.add(
                User(
                    id=user_id,
                    name="范围受限设备管理员",
                    role="device",
                    enabled=True,
                    is_demo=True,
                    building_ids_json=__import__("json").dumps(building_ids),
                )
            )
            session.commit()
        engine.dispose()
        return token_of(self.client, user_id)

    def seed_crack(self, code: str = "B03-F2-CRACK01") -> dict:
        building = self.ok(
            self.post(
                "/buildings",
                {
                    "code": "B03",
                    "name": "3号教学楼",
                    "purpose": "教学",
                    "footprint": {"x": 0.4, "y": 0.6, "w": 0.2, "h": 0.2, "rotate": 0},
                },
                key="b03",
            )
        )
        floor = self.ok(
            self.post(
                "/floors",
                {"buildingId": building["id"], "floorNo": 2, "name": "二层", "zones": ["走廊"]},
                key="f2",
            )
        )
        point = self.ok(
            self.post(
                "/points",
                {
                    "code": code,
                    "name": "裂缝测点",
                    "buildingId": building["id"],
                    "floorId": floor["id"],
                    "type": "crack",
                    "coord": {"x": 0.5, "y": 0.5},
                    "nfcLabel": "NFC-CRACK-01",
                },
                key="crack-point",
            )
        )
        device = self.ok(
            self.post(
                "/devices",
                {
                    "code": "B03-F2-CRACK01-DEV1",
                    "name": "裂缝计",
                    "pointId": point["id"],
                    "rangeMin": 0,
                    "rangeMax": 2,
                    "unit": "mm",
                },
                key="crack-device",
            )
        )
        rule = self.ok(
            self.post(
                "/rules",
                {
                    "code": "RULE-CRACK-001",
                    "name": "裂缝宽度变化分级规则",
                    "metric": "crack_width",
                    "unit": "mm",
                    "thresholds": {"yellow": 0.1, "orange": 0.2, "red": 0.3},
                    "rateThreshold": None,
                    "persistence": {
                        "minRecords": 3,
                        "minSpanMinutes": 10,
                        "maxGapMinutes": 5,
                        "level": "orange",
                    },
                    "recovery": {"yellowRatio": 0.8, "minRecords": 3, "minSpanMinutes": 0},
                    "effectiveFrom": iso(-60 * 24 * 30),
                    "source": "测试规则",
                },
                key="crack-rule",
            )
        )
        baseline = self.ok(
            self.post(
                "/baselines",
                {
                    "pointId": point["id"],
                    "values": {"width": 0.5},
                    "unit": "mm",
                    "reason": "初始基准",
                    "effectiveFrom": iso(-60 * 24 * 20),
                },
                key="crack-baseline",
            )
        )
        return {
            "building": building,
            "floor": floor,
            "point": point,
            "device": device,
            "rule": rule,
            "baseline": baseline,
        }

    def add_record(self, point_id: str, width: float, minutes: float = -60, **extra) -> dict:
        body = {
            "pointId": point_id,
            "values": {"width": width},
            "unit": "mm",
            "sampleTime": iso(minutes),
            "source": "manual",
            "quality": "valid",
            "note": extra.pop("note", "现场录入"),
            **extra,
        }
        return self.ok(self.post("/records", body))


def role_label(role: str) -> str:
    return ROLES[role]
