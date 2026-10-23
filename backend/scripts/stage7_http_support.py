# ruff: noqa: E501
"""阶段 7 真实 HTTP 证据的客户端与固定前置数据（只写独立临时库）。"""

import base64
import json
import sqlite3
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

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
        response = self.http.post(self.path(suffix), json=body, headers=self.headers(account, key))
        assert response.status_code in (200, 201), (
            f"{suffix}: {response.status_code} {response.text}"
        )
        return response.json()["data"]

    def ask(
        self,
        question: str,
        context: dict | None = None,
        key: str = "ask",
        account: str = "demo-safety",
        session_id: str | None = None,
    ):
        body: dict = {"question": question, "context": context or {}}
        if session_id:
            body["sessionId"] = session_id
        response = self.http.post(
            self.path("/assistant/query"), json=body, headers=self.headers(account, key)
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


def seed_archive(api: Api) -> dict:
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
        "s7-crack",
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
        "s7-manual",
    )
    crack2 = api.post(
        "/points",
        {
            "code": "B05-F2-CRACK02",
            "name": "第二裂缝测点",
            "buildingId": building["id"],
            "floorId": floor["id"],
            "type": "crack",
            "coord": {"x": 0.6, "y": 0.6},
        },
        "s7-crack2",
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
            "pointId": crack["id"],
            "values": {"width": 0.5},
            "unit": "mm",
            "reason": "初始基准",
            "effectiveFrom": stamp(-60 * 24 * 20),
        },
        "s7-baseline",
    )
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
    other_crack = api.post(
        "/points",
        {
            "code": "B06-F1-CRACK01",
            "name": "6号楼裂缝测点",
            "buildingId": other["id"],
            "floorId": other_floor["id"],
            "type": "crack",
            "coord": {"x": 0.5, "y": 0.5},
        },
        "s7-crack-b06",
    )
    return {
        "building": building,
        "floor": floor,
        "crack": crack,
        "crack2": crack2,
        "manual": manual,
        "device": device,
        "otherBuilding": other,
        "otherPoint": other_crack,
    }


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


def issue_body(point: dict, submission: str) -> dict:
    return {
        "source": "report",
        "pointId": point["id"],
        "buildingId": point["buildingId"],
        "floorId": point["floorId"],
        "anomalyType": "裂缝越限",
        "description": "阶段 7 固定前置问题",
        "submissionId": submission,
    }


def seed_field(api: Api, ids: dict, event: dict) -> dict:
    sensor = api.post(
        "/issues",
        {
            **issue_body(ids["crack"], "s7-sensor-issue"),
            "source": "sensor",
            "eventId": event["id"],
        },
        "s7-sensor-issue-key",
    )["issue"]
    reviewed = api.post(
        f"/issues/{sensor['id']}/review",
        {
            "expectedRev": sensor["rev"],
            "action": "to_repair",
            "category": "equipment",
            "note": "现场核实后转维修处理",
        },
        "s7-review-repair",
    )
    order = reviewed["order"]
    order = api.post(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "assigned", "assigneeId": "demo-repair"},
        "s7-assign",
    )["order"]
    order = api.post(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "repairing"},
        "s7-accept",
        "demo-repair",
    )["order"]
    order = api.post(
        f"/work-orders/{order['id']}/actions",
        {
            "expectedRev": order["rev"],
            "to": "submitted",
            "measures": "更换固定件并复紧",
            "materials": "固定件",
            "photos": [],
        },
        "s7-submit",
        "demo-repair",
    )["order"]
    closing = api.post(
        "/issues", issue_body(ids["manual"], "s7-manual-issue"), "s7-manual-issue-key"
    )["issue"]
    api.post(
        f"/issues/{closing['id']}/review",
        {
            "expectedRev": closing["rev"],
            "action": "close_no_fault",
            "category": "no_fault",
            "note": "现场核查确认无结构异常，无需维修",
        },
        "s7-review-close",
    )
    return {
        "issue": next(row for row in api.get("/issues") if row["id"] == sensor["id"]),
        "order": order,
        "closedIssue": closing,
    }


def seed_knowledge(api: Api) -> dict:
    first = api.post(
        "/knowledge/documents",
        {
            "title": "预警分级与处置要求",
            "sourcePath": "docs/knowledge/预警分级.md",
            "sourceKind": "project",
            "roles": ["safety", "property", "device", "inspector", "repair"],
            "content": "# 预警分级\n\n红色为紧急核查门槛，需要学校安全管理人员立即确认并组织核查。\n确认后进入处理中，处置完成后仍需恢复复测满足条件才能关闭。",
        },
        "s7-knowledge-doc-1",
    )
    second = api.post(
        "/knowledge/documents",
        {
            "title": "工单验收要求",
            "sourcePath": "docs/knowledge/工单验收.md",
            "sourceKind": "project",
            "roles": ["safety", "property", "device", "inspector", "repair"],
            "content": "# 工单验收\n\n维修工单由学校安全管理人员验收，维修人员不能自行验收。\n验收通过只进入待复查，不直接关闭问题。",
        },
        "s7-knowledge-doc-2",
    )
    api.post(
        "/knowledge/faqs",
        {
            "chunkId": first["chunks"][0]["id"],
            "questions": ["红色预警代表什么要求", "红色预警怎么处置"],
        },
        "s7-faq-1",
    )
    api.post(
        "/knowledge/faqs",
        {
            "chunkId": second["chunks"][0]["id"],
            "questions": ["工单验收由谁负责", "维修人员能自己验收吗"],
        },
        "s7-faq-2",
    )
    return {"first": first, "second": second}


def seed_media(api: Api, point_id: str) -> dict:
    before = api.upload(point_id, "s7-media-before")
    after = api.upload(point_id, "s7-media-after")
    first = api.post(
        "/media-sessions/frames",
        {
            "mediaId": before["id"],
            "pointId": point_id,
            "label": "处置前",
            "capturedAt": stamp(-120),
        },
        "s7-frame-before",
    )
    second = api.post(
        "/media-sessions/frames",
        {"mediaId": after["id"], "pointId": point_id, "label": "处置后", "capturedAt": stamp(-60)},
        "s7-frame-after",
    )
    saved = api.post(
        "/media-sessions/comparisons",
        {
            "pointId": point_id,
            "beforeId": first["id"],
            "afterId": second["id"],
            "result": {
                "changedRatio": 0.021,
                "maxRegionRatio": 0.018,
                "region": {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5},
                "status": "changed",
                "note": "像素差统计",
                "source": "session",
            },
        },
        "s7-compare",
    )
    return {
        "before": before,
        "after": after,
        "frame": first,
        "secondFrame": second,
        "comparison": saved,
    }


def add_scoped_user(db_path: Path, user_id: str, building_ids: list[str]) -> None:
    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "INSERT OR REPLACE INTO users (id,name,role,enabled,is_demo,building_ids_json) VALUES (?,?,?,?,?,?)",
            (user_id, "范围受限验证身份", "safety", 1, 1, json.dumps(building_ids)),
        )
        connection.commit()
    finally:
        connection.close()


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
