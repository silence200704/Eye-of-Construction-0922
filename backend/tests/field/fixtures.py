"""阶段 5 测试夹具：复用阶段 4 的档案与命令上下文。"""

import base64
import hashlib
import json
import os
import struct
import zlib
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from monitoring.fixtures import Api, token_of
from sqlalchemy import create_engine, text

SHANGHAI = timezone(timedelta(hours=8))

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC"
)


def noise_png(width: int = 500, height: int = 500) -> bytes:
    """生成不可压缩但合法的 PNG，用于验证 600 KB 归属配额。"""

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + os.urandom(width * 3) for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def counts(database_url: str, *tables: str) -> dict[str, int]:
    engine = create_engine(database_url)
    with engine.connect() as connection:
        result = {
            table: connection.execute(text(f'select count(*) from "{table}"')).scalar_one()
            for table in tables
        }
    engine.dispose()
    return result


def today() -> str:
    return datetime.now(SHANGHAI).date().isoformat()


class FieldApi(Api):
    def __init__(self, client: TestClient, database_url: str) -> None:
        super().__init__(client, database_url)
        self._tokens: dict[str, str] = {"demo-safety": self.token}

    def token_for(self, account: str) -> str:
        if account not in self._tokens:
            self._tokens[account] = token_of(self.client, account)
        return self._tokens[account]

    def fpost(self, path: str, body: dict, key: str, account: str = "demo-safety"):
        return self.client.post(
            f"/api/v1/datasets/demo-main{path}",
            json=body,
            headers={
                "Authorization": f"Bearer {self.token_for(account)}",
                "X-Dataset-Epoch": str(self.epoch),
                "Idempotency-Key": key,
            },
        )

    def fpatch(self, path: str, body: dict, account: str = "demo-safety", key: str | None = None):
        return self.client.patch(
            f"/api/v1/datasets/demo-main{path}",
            json=body,
            headers={
                "Authorization": f"Bearer {self.token_for(account)}",
                "X-Dataset-Epoch": str(self.epoch),
                "Idempotency-Key": key or "patch-" + path,
            },
        )

    def ok_post(self, path: str, body: dict, key: str, account: str = "demo-safety") -> dict:
        response = self.fpost(path, body, key, account)
        assert response.status_code == 200, response.text
        return response.json()["data"]

    def upload_photo(
        self,
        point_id: str | None = None,
        key: str = "photo-1",
        **options,
    ) -> dict:
        data = options.get("data", PNG)
        account = options.get("account", "demo-safety")
        file_name = options.get("file_name", "现场.png")
        params = {"fileName": file_name}
        if point_id:
            params["pointId"] = point_id
        response = self.client.post(
            "/api/v1/datasets/demo-main/media",
            params=params,
            headers={
                "Authorization": f"Bearer {self.token_for(account)}",
                "Content-Type": "image/png",
                "Idempotency-Key": key,
            },
            content=data,
        )
        assert response.status_code in (200, 201), response.text
        return response.json()["data"]

    def create_maintenance_plan(self, device_id: str, building_id: str, **overrides) -> dict:
        body = {
            "name": "裂缝计季度保养",
            "deviceId": device_id,
            "buildingId": building_id,
            "cycle": {"unit": "day", "interval": 1, "atTime": "08:30"},
            "startDate": "2026-01-01",
            "endDate": None,
            "owner": "设备管理员",
            "checklist": [
                {"key": "bolt", "label": "固定螺栓", "required": True},
                {"key": "rust", "label": "锈蚀检查", "required": True},
            ],
            "enabled": True,
            "remark": "",
            **overrides,
        }
        return self.ok_post("/maintenance/plans", body, "mplan-" + device_id)

    def generate_maintenance(self, day: str | None = None, key: str | None = None) -> dict:
        target = day or today()
        return self.ok_post(
            "/maintenance/tasks/generate",
            {"date": target},
            key or "mgen-" + target,
        )

    def execute_maintenance(
        self, task: dict, payload: dict, key: str, account: str = "demo-safety"
    ) -> dict:
        return self.ok_post(
            f"/maintenance/tasks/{task['id']}/execute",
            {"expectedRev": task["rev"], **payload},
            key,
            account,
        )

    def seed_manual_point(self, code: str = "B03-F2-CHECK01") -> dict:
        ids = self.seed_crack()
        point = self.ok(
            self.post(
                "/points",
                {
                    "code": code,
                    "name": "人工检查点",
                    "buildingId": ids["building"]["id"],
                    "floorId": ids["floor"]["id"],
                    "type": "manual_check",
                    "coord": {"x": 0.4, "y": 0.4},
                },
                key="manual-point-" + code,
            )
        )
        return {**ids, "manual": point}

    def create_plan(self, point_id: str, building_id: str, floor_id: str, **overrides) -> dict:
        body = {
            "name": "日常巡检",
            "kind": "patrol",
            "buildingId": building_id,
            "floorIds": [floor_id],
            "pointIds": [point_id],
            "cycle": {"unit": "day", "interval": 1, "atTime": "09:00"},
            "startDate": "2026-01-01",
            "endDate": None,
            "owner": "巡检负责人",
            "executorRole": "inspector",
            "checklist": [{"key": "wall", "label": "墙面", "required": True, "hint": ""}],
            "enabled": True,
            **overrides,
        }
        return self.ok_post("/inspection/plans", body, "plan-" + point_id)

    def generate(self, day: str | None = None, key: str | None = None) -> dict:
        target = day or today()
        return self.ok_post(
            "/inspection/tasks/generate",
            {"date": target},
            key or "generate-" + target,
        )

    def task_for_point(self, point_id: str) -> dict:
        return next(
            row
            for row in self.get("/inspection/tasks")
            if any(item["pointId"] == point_id for item in row["results"])
        )

    def report_issue(self, point: dict, **overrides) -> dict:
        body = {
            "source": "report",
            "pointId": point["id"],
            "buildingId": point["buildingId"],
            "floorId": point["floorId"],
            "zoneId": point["zoneId"],
            "anomalyType": "墙面裂缝",
            "description": "现场发现新增裂缝",
            "submissionId": "sub-" + point["id"],
            "photos": [],
            **overrides,
        }
        return self.ok_post("/issues", body, "issue-" + body["submissionId"])

    def review(self, issue: dict, action: str, category: str, **overrides) -> dict:
        body = {
            "expectedRev": issue["rev"],
            "action": action,
            "category": category,
            "note": "审核意见：现场情况已核对，按本出口处理",
            **overrides,
        }
        return self.ok_post(
            f"/issues/{issue['id']}/review", body, f"review-{issue['id']}-{action}-{category}"
        )

    def register_recheck(self, issue: dict, **overrides) -> dict:
        body = {
            "expectedRev": issue["rev"],
            "subject": "复查裂缝宽度",
            "owner": "学校安全管理人员",
            "dueDate": date.today().isoformat(),
            **overrides,
        }
        return self.ok_post(f"/issues/{issue['id']}/rechecks", body, f"recheck-{issue['id']}")

    def recheck_outcome(self, issue: dict, outcome: str, **overrides) -> dict:
        body = {
            "expectedRev": issue["rev"],
            "outcome": outcome,
            "note": "复查依据：现场复测与记录核对完成",
            **overrides,
        }
        return self.ok_post(
            f"/issues/{issue['id']}/rechecks/outcome",
            body,
            f"outcome-{issue['id']}-{outcome}",
        )

    def advance(self, order: dict, to: str, account: str = "demo-safety", **overrides) -> dict:
        body = {"expectedRev": order["rev"], "to": to, **overrides}
        digest = hashlib.sha256(
            json.dumps(body, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()[:16]
        return self.ok_post(
            f"/work-orders/{order['id']}/actions",
            body,
            f"advance-{order['id']}-{account}-{digest}",
            account,
        )
