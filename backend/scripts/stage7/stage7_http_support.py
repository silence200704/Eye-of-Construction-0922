# ruff: noqa: E501
"""阶段 7 真实 HTTP 证据的客户端与固定前置数据（只写独立临时库）。"""

import base64
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone

import httpx

SHANGHAI = timezone(timedelta(hours=8))
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)


def stamp(minutes: int = 0) -> str:
    return (datetime.now(UTC) + timedelta(minutes=minutes)).isoformat()


class Api:
    def __init__(self, base: str, dataset: str = "demo-main") -> None:
        self.http = httpx.Client(base_url=base, timeout=60, trust_env=False)
        self.dataset = dataset
        self.tokens: dict[str, str] = {}
        self.epoch = 1

    def token(self, account: str) -> str:
        if account not in self.tokens:
            response = self.http.post("demo/identity", json={"identityId": account})
            assert response.status_code == 200, response.text
            self.tokens[account] = response.json()["data"]["accessToken"]
        return self.tokens[account]

    def headers(self, account: str, key: str | None = None) -> dict:
        headers = {"Authorization": f"Bearer {self.token(account)}"}
        if key is not None:
            headers["Idempotency-Key"] = key
            headers["X-Dataset-Epoch"] = str(self.epoch)
        return headers

    def path(self, suffix: str) -> str:
        return f"datasets/{self.dataset}{suffix}"

    def get(self, suffix: str, account: str = "demo-safety"):
        response = self.http.get(self.path(suffix), headers=self.headers(account))
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def post(self, suffix: str, body: dict, key: str, account: str = "demo-safety"):
        response = self.http.post(
            self.path(suffix),
            json=body,
            headers=self.headers(account, key),
        )
        assert response.status_code in (200, 201), (
            f"{suffix}: {response.status_code} {response.text}"
        )
        return response.json()["data"]

    def ask(self, question: str, context: dict | None = None, **options):
        body: dict = {"question": question, "context": context or {}}
        if options.get("sessionId"):
            body["sessionId"] = options["sessionId"]
        response = self.http.post(
            self.path("/assistant/query"),
            json=body,
            headers=self.headers(options.get("account", "demo-safety"), options.get("key", "ask")),
        )
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def upload(self, point_id: str, key: str) -> dict:
        response = self.http.post(
            self.path("/media"),
            params={"fileName": "stage7.png", "pointId": point_id},
            content=PNG,
            headers={**self.headers("demo-safety", key), "Content-Type": "image/png"},
        )
        assert response.status_code in (200, 201), response.text
        return response.json()["data"]

    def content(self, media_id: str):
        return self.http.get(
            self.path(f"/media/{media_id}/content"),
            headers={"Authorization": f"Bearer {self.token('demo-safety')}"},
        )

    def close(self) -> None:
        self.http.close()


def _seed_main_archive(api: Api) -> dict:
    building = api.post(
        "/buildings",
        {
            "code": "B05",
            "name": "5号实验楼",
            "purpose": "实验",
            "footprint": {"x": 0.4, "y": 0.6, "w": 0.2, "h": 0.2, "rotate": 0},
        },
        "s7-building",
    )
    floor = api.post(
        "/floors",
        {"buildingId": building["id"], "floorNo": 2, "name": "二层", "zones": ["走廊"]},
        "s7-floor",
    )
    crack = _point(
        api,
        building["id"],
        floor["id"],
        PointSeed("B05-F2-CRACK01", "裂缝测点", "s7-crack", {"nfcLabel": "NFC-B05-01"}),
    )
    manual = _point(
        api,
        building["id"],
        floor["id"],
        PointSeed("B05-F2-CHECK01", "巡检点", "s7-manual", {"coord": {"x": 0.45, "y": 0.45}}),
    )
    crack2 = _point(
        api,
        building["id"],
        floor["id"],
        PointSeed("B05-F2-CRACK02", "第二裂缝测点", "s7-crack2", {"coord": {"x": 0.6, "y": 0.6}}),
    )
    device = api.post(
        "/devices",
        {
            "code": "B05-CRACK-DEV1",
            "name": "裂缝计",
            "pointId": crack["id"],
            "rangeMin": 0,
            "rangeMax": 2,
            "unit": "mm",
        },
        "s7-device",
    )
    _rule_and_baseline(api, crack["id"])
    return {
        "building": building,
        "floor": floor,
        "crack": crack,
        "crack2": crack2,
        "manual": manual,
        "device": device,
    }


@dataclass(frozen=True)
class PointSeed:
    code: str
    name: str
    key: str
    extra: dict = field(default_factory=dict)


def _point(api: Api, building_id: str, floor_id: str, seed: PointSeed) -> dict:
    return api.post(
        "/points",
        {
            "code": seed.code,
            "name": seed.name,
            "buildingId": building_id,
            "floorId": floor_id,
            "type": "crack" if "CRACK" in seed.code else "manual_check",
            "coord": {"x": 0.5, "y": 0.5},
            **seed.extra,
        },
        seed.key,
    )


def _rule_and_baseline(api: Api, point_id: str) -> None:
    api.post(
        "/rules",
        {
            "code": "RULE-S7-CRACK",
            "name": "裂缝宽度分级规则",
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
            "effectiveFrom": stamp(-60 * 24 * 30),
            "source": "阶段 7 证据",
        },
        "s7-rule",
    )
    api.post(
        "/baselines",
        {
            "pointId": point_id,
            "values": {"width": 0.5},
            "unit": "mm",
            "reason": "初始基准",
            "effectiveFrom": stamp(-60 * 24 * 20),
        },
        "s7-baseline",
    )


def _seed_other_building(api: Api) -> dict:
    other = api.post(
        "/buildings",
        {
            "code": "B06",
            "name": "6号实验楼",
            "purpose": "实验",
            "footprint": {"x": 0.7, "y": 0.6, "w": 0.2, "h": 0.2, "rotate": 0},
        },
        "s7-building-b06",
    )
    other_floor = api.post(
        "/floors",
        {"buildingId": other["id"], "floorNo": 1, "name": "一层", "zones": ["走廊"]},
        "s7-floor-b06",
    )
    other_crack = _point(
        api,
        other["id"],
        other_floor["id"],
        PointSeed("B06-F1-CRACK01", "6号楼裂缝测点", "s7-crack-b06"),
    )
    return {"otherBuilding": other, "otherPoint": other_crack}


def seed_archive(api: Api) -> dict:
    ids = _seed_main_archive(api)
    ids.update(_seed_other_building(api))
    return ids


def record(api: Api, point_id: str, width: float, minutes: int, key: str) -> dict:
    return api.post(
        "/records",
        {
            "pointId": point_id,
            "values": {"width": width},
            "unit": "mm",
            "sampleTime": stamp(minutes),
            "source": "manual",
            "quality": "valid",
            "note": "阶段 7 固定前置记录",
        },
        key,
    )


def seed_records(api: Api, ids: dict) -> dict:
    for index, (width, minutes) in enumerate(
        [(0.05, -100), (0.12, -90), (0.55, -80), (0.60, -70), (0.82, -60)]
    ):
        record(api, ids["crack"]["id"], width, minutes, f"s7-crack-record-{index}")
    record(api, ids["crack2"]["id"], 0.42, -30, "s7-crack2-record")
    record(api, ids["otherPoint"]["id"], 0.11, -25, "s7-b06-record")
    return {row["id"]: row for row in api.get("/events")}


def snapshot(api: Api) -> dict:
    archive = api.get("/archive")
    return {
        "points": [{k: row[k] for k in ("id", "code", "status")} for row in archive["points"]],
        "devices": [{k: row[k] for k in ("id", "code")} for row in archive["devices"]],
        "events": [
            {k: row[k] for k in ("id", "eventNo", "level", "status", "pointId")}
            for row in api.get("/events")
        ],
        "issues": [
            {k: row[k] for k in ("id", "issueNo", "status", "pointId", "workOrderIds")}
            for row in api.get("/issues")
        ],
        "orders": [
            {k: row[k] for k in ("id", "orderNo", "status", "issueId", "pointId")}
            for row in api.get("/work-orders")
        ],
        "records": len(api.get("/records")),
    }
