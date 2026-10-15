import math
import re

from sqlalchemy import JSON, Boolean, Float, Integer, String

from ...operations.importing.prepare import digest
from ...operations.importing.types import ImportContext


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def values_for(model: type, raw: dict, context: ImportContext) -> dict:
    values = {snake(key): value for key, value in raw.items()}
    if model.__tablename__ == "points":
        values.update(
            x=raw["coord"]["x"], y=raw["coord"]["y"], nfc_code=(raw.get("nfc") or {}).get("code")
        )
    if model.__tablename__ == "records":
        values["record_revision"] = values.pop("revision", 0)
    values.update(dataset_id=context.dataset_id, revision=1, legacy_payload=raw)
    if "updated_at" in model.__table__.columns and "updated_at" not in values:
        values["updated_at"] = raw.get("createdAt", "")
    for column in model.__table__.columns:
        if column.name not in values:
            if column.nullable:
                values[column.name] = None
            elif column.default is None and column.server_default is None:
                raise ValueError(f"缺少必填字段 {column.name}")
        elif column.name.endswith("_id") and column.nullable and values[column.name] == "":
            values[column.name] = None
        if column.name in values:
            check_type(column, values[column.name])
    return {key: value for key, value in values.items() if key in model.__table__.columns}


def check_type(column: object, value: object) -> None:
    if value is None and column.nullable:
        return
    kind = column.type
    valid = True
    if isinstance(kind, Boolean):
        valid = type(value) is bool
    elif isinstance(kind, Integer):
        valid = type(value) is int
    elif isinstance(kind, Float):
        valid = type(value) in (int, float) and math.isfinite(value)
    elif isinstance(kind, String):
        valid = isinstance(value, str)
    elif isinstance(kind, JSON):
        valid = isinstance(value, (dict, list)) or value is None
    if not valid:
        raise ValueError(f"字段 {column.name} 类型无效")


def equivalent(row: object, values: dict) -> bool:
    return all(
        digest(getattr(row, key)) == digest(value)
        for key, value in values.items()
        if key not in {"storage_key", "uploaded_at"}
    )
