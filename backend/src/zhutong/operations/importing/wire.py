import hashlib
import json


def digest(value: object) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return hashlib.sha256(encoded.encode()).hexdigest()


def problem(table: str, identifier: str, message: str) -> dict:
    return {"table": table, "id": identifier, "message": message}
