# ruff: noqa: E501
"""阶段 5 真实 HTTP 证据：用独立临时数据库跑两条闭环与保养/报表。

运行前先启动 18001 端口临时 API，并在同一 SQLite 上核对审计与回执。
本脚本只写临时库，不触碰 demo-main 正式数据。
"""

import base64
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:18001/api/v1/"
DATASET = "demo-main"
DB = Path(__file__).resolve().parents[1] / ".runtime-stage5-verify" / "stage5.sqlite"
OUT = (
    Path(__file__).resolve().parents[2]
    / "docs/implementation/evidence/stage5-field/verification.json"
)
SHANGHAI = timezone(timedelta(hours=8))
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)


def day(offset: int = 0) -> str:
    return (datetime.now(SHANGHAI).date() + timedelta(days=offset)).isoformat()


def stamp(minutes: int = 0) -> str:
    return (datetime.now(UTC) + timedelta(minutes=minutes)).isoformat()


class Api:
    def __init__(self) -> None:
        self.http = httpx.Client(base_url=BASE, timeout=30, trust_env=False)
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

    def get(self, path: str) -> dict:
        response = self.http.get(f"datasets/{DATASET}{path}", headers=self.headers("demo-safety"))
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def post(self, path: str, body: dict, key: str, account: str = "demo-safety") -> dict:
        response = self.http.post(
            f"datasets/{DATASET}{path}", json=body, headers=self.headers(account, key)
        )
        if response.status_code != 200:
            raise AssertionError(f"{path}: {response.status_code} {response.text}")
        return response.json()["data"]

    def try_post(self, path: str, body: dict, key: str, account: str = "demo-safety"):
        return self.http.post(
            f"datasets/{DATASET}{path}", json=body, headers=self.headers(account, key)
        )

    def patch(self, path: str, body: dict, key: str) -> dict:
        response = self.http.patch(
            f"datasets/{DATASET}{path}", json=body, headers=self.headers("demo-safety", key)
        )
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def upload(self, blob: bytes, point_id: str, key: str, account: str = "demo-safety") -> dict:
        response = self.http.post(
            f"datasets/{DATASET}/media",
            params={"fileName": "stage5.png", "pointId": point_id},
            content=blob,
            headers={
                **self.headers(account, key),
                "Content-Type": "image/png",
            },
        )
        assert response.status_code in (200, 201), response.text
        return response.json()["data"]


def seed(api: Api) -> dict:
    building = api.post(
        "/buildings",
        {
            "code": "B05",
            "name": "5号实验楼",
            "purpose": "实验",
            "footprint": {"x": 0.4, "y": 0.6, "w": 0.2, "h": 0.2, "rotate": 0},
        },
        "s5-building",
    )
    floor = api.post(
        "/floors",
        {"buildingId": building["id"], "floorNo": 2, "name": "二层", "zones": ["走廊"]},
        "s5-floor",
    )
    crack = api.post(
        "/points",
        {
            "code": "B05-F2-CRACK01",
            "name": "裂缝测点",
            "buildingId": building["id"],
            "floorId": floor["id"],
            "type": "crack",
            "coord": {"x": 0.5, "y": 0.5},
            "nfcLabel": "NFC-B05-01",
        },
        "s5-crack-point",
    )
    manual = api.post(
        "/points",
        {
            "code": "B05-F2-CHECK01",
            "name": "巡检点",
            "buildingId": building["id"],
            "floorId": floor["id"],
            "type": "manual_check",
            "coord": {"x": 0.45, "y": 0.45},
        },
        "s5-manual-point",
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
        "s5-device",
    )
    api.post(
        "/rules",
        {
            "code": "RULE-S5-CRACK",
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
            "source": "阶段 5 证据",
        },
        "s5-rule",
    )
    api.post(
        "/baselines",
        {
            "pointId": crack["id"],
            "values": {"width": 0.5},
            "unit": "mm",
            "reason": "初始基准",
            "effectiveFrom": stamp(-60 * 24 * 20),
        },
        "s5-baseline",
    )
    return {
        "building": building,
        "floor": floor,
        "crack": crack,
        "manual": manual,
        "device": device,
    }


def issue_body(point: dict, submission: str, photos: list[dict] | None = None) -> dict:
    return {
        "source": "report",
        "pointId": point["id"],
        "buildingId": point["buildingId"],
        "floorId": point["floorId"],
        "zoneId": point.get("zoneId", ""),
        "anomalyType": "现场异常",
        "description": f"阶段 5 证据上报 {submission}",
        "submissionId": submission,
        "photos": photos or [],
    }


def review(api: Api, issue: dict, action: str, category: str, note: str, **extra) -> dict:
    return api.post(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": issue["rev"],
            "action": action,
            "category": category,
            "note": note,
            **extra,
        },
        f"s5-review-{issue['id']}-{action}",
    )


def order_flow(api: Api, issue: dict, photos: list[dict] | None = None) -> dict:
    order = review(api, issue, "to_repair", "equipment", "现场核实后转维修处理")["order"]
    order = api.post(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "assigned", "assigneeId": "demo-repair"},
        f"s5-assign-{order['id']}",
    )["order"]
    order = api.post(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "repairing"},
        f"s5-accept-{order['id']}",
        "demo-repair",
    )["order"]
    return api.post(
        f"/work-orders/{order['id']}/actions",
        {
            "expectedRev": order["rev"],
            "to": "submitted",
            "measures": "更换固定件并复紧",
            "materials": "固定件",
            "photos": photos or [],
        },
        f"s5-submit-{order['id']}",
        "demo-repair",
    )["order"]
