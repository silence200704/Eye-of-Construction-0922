# ruff: noqa: E501
"""返修补证的共享小工具：最新读数、范围写库、epoch 写库与候选阈值版本。"""

import json
import sqlite3

from stage7_http_support import stamp


def latest_value(api, point_id: str) -> str:
    rows = [row for row in api.get("/records") if row["pointId"] == point_id]
    latest = max(rows, key=lambda row: row["sampleTime"])
    return f"{next(iter(latest['values'].values())):g}"


def set_scope(db_path, building_ids: list[str]) -> None:
    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "UPDATE users SET building_ids_json=? WHERE id=?",
            (json.dumps(building_ids), "verify-scoped"),
        )
        connection.commit()
    finally:
        connection.close()


def bump_epoch(db_path) -> None:
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("UPDATE datasets SET epoch = epoch + 1 WHERE id='demo-main'")
        connection.commit()
    finally:
        connection.close()


def new_rule_version(api, rule: dict, enabled: bool, key: str) -> dict:
    body = {
        name: rule[name]
        for name in (
            "code",
            "name",
            "metric",
            "unit",
            "thresholds",
            "rateThreshold",
            "rateLevel",
            "persistence",
            "recovery",
            "environment",
            "baselineSource",
            "buildingIds",
            "pointIds",
            "fixedBaseline",
            "source",
            "confirmedBy",
            "note",
        )
    }
    body.update(
        {
            "enabled": enabled,
            "expectedVersion": rule["version"],
            "expectedRev": rule["rev"],
            "effectiveFrom": stamp(-1),
        }
    )
    return api.post(f"/rules/{rule['ruleId']}/versions", body, key)


def reply_meta(api, key: str, question: str) -> tuple[int, dict]:
    response = api.http.post(
        api.path("/assistant/query"),
        json={"question": question, "context": {}},
        headers=api.headers("demo-safety", key),
    )
    return response.status_code, response.json()
