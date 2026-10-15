import hashlib
import json

from .types import ImportPlan

TABLES = (
    "buildings",
    "floors",
    "points",
    "devices",
    "baselines",
    "records",
    "audits",
    "rules",
    "events",
    "notifications",
    "plans",
    "tasks",
    "issues",
    "workOrders",
    "attachments",
    "maintenancePlans",
    "maintenanceTasks",
)


def digest(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return hashlib.sha256(encoded.encode()).hexdigest()


def problem(table: str, identifier: str, message: str) -> dict:
    return {"table": table, "id": identifier, "message": message}


def prepare(payload: dict) -> ImportPlan:
    source = payload.get("sourceName", "legacy-json-backup")
    data, runtime = payload.get("data", {}), payload.get("runtime", {})
    errors = []
    if payload.get("format") not in {"zhutong-migration-v1", "zhutong-demo-backup"}:
        errors.append(problem("package", "format", "不支持的备份格式"))
    version = payload.get("schemaVersion")
    if type(version) is not int or not 1 <= version <= 7:
        errors.append(problem("package", "schemaVersion", "仅支持旧库版本 1—7"))
    if not isinstance(source, str) or not 1 <= len(source) <= 180:
        errors.append(problem("package", "sourceName", "来源名称无效"))
        source = "invalid"
    if not isinstance(data, dict) or not isinstance(runtime, dict):
        errors.append(problem("package", "data", "数据与运行状态必须为对象"))
        data, runtime = {}, {}
    if set(data) - set(TABLES):
        errors.append(problem("package", "data", "包含未知业务表，不能静默丢弃"))
    counts = payload.get("counts", {})
    if not isinstance(counts, dict):
        errors.append(problem("package", "counts", "数量清单必须为对象"))
        counts = {}
    normalized = {}
    for table in TABLES:
        rows = data.get(table, [])
        if not isinstance(rows, list) or any(
            not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]
            for row in rows
        ):
            errors.append(problem(table, "", "表必须为具有非空字符串 id 的对象数组"))
            rows = []
        ids = [row["id"] for row in rows]
        if len(ids) != len(set(ids)):
            errors.append(problem(table, "", "同一表中存在重复旧编号"))
        if table in counts and counts[table] != len(rows):
            errors.append(problem(table, "", "声明数量与实际行数不一致"))
        normalized[table] = rows
    fingerprint = digest({"source": source, "data": normalized, "runtime": runtime})
    report = {
        "valid": not errors,
        "sourceName": source,
        "sourceHash": fingerprint,
        "errors": errors,
        "warnings": payload.get("warnings", []),
        "tables": {
            table: {"source": len(rows), "inserted": 0, "matched": 0}
            for table, rows in normalized.items()
        },
        "fieldsVerified": 0,
        "filesVerified": 0,
    }
    return ImportPlan(source, fingerprint, normalized, runtime, report)
