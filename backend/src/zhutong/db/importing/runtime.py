
from sqlalchemy import insert

from ...operations.importing.prepare import digest
from ...operations.importing.types import ImportContext, ImportPlan
from ..models.foundation import OperationReceipt, Preference, SessionState


def save_runtime(session: object, context: ImportContext, plan: ImportPlan) -> None:
    for item in plan.runtime.get("preferences", []):
        key = item["key"]
        value = item["value"]
        stable = digest({"source": plan.source_name, "key": key, "value": value})
        identifier = "legacy-pref-" + stable[:40]
        if session.get(Preference, (context.dataset_id, identifier)) is None:
            session.execute(
                insert(Preference),
                {
                    "dataset_id": context.dataset_id,
                    "id": identifier,
                    "actor_id": context.actor.id,
                    "key": f"legacy/{stable}",
                    "value": {"key": key, "value": value, "sourceName": plan.source_name},
                },
            )
        if key.endswith("/operation-receipts"):
            save_receipts(session, context, value)
    for kind in ("assistant", "scenario", "showcase", "video"):
        if kind in plan.runtime:
            session.execute(
                insert(SessionState),
                {
                    "dataset_id": context.dataset_id,
                    "id": f"{plan.source_hash}:{kind}",
                    "actor_id": context.actor.id,
                    "kind": kind,
                    "state": {
                        "sourceName": plan.source_name,
                        "snapshot": plan.runtime[kind],
                        "restoreMode": "paused-read-only",
                    },
                },
            )


def save_receipts(session: object, context: ImportContext, value: object) -> None:
    import json

    rows = json.loads(value) if isinstance(value, str) else value
    if not isinstance(rows, list):
        return
    for row in rows:
        fingerprint = digest(row)
        identifier = "legacy-receipt-" + fingerprint[:40]
        if session.get(OperationReceipt, (context.dataset_id, identifier)) is None:
            session.execute(
                insert(OperationReceipt),
                {
                    "dataset_id": context.dataset_id,
                    "id": identifier,
                    "epoch": 1,
                    "actor_id": "legacy-browser",
                    "operation": "legacy-receipt",
                    "key": fingerprint,
                    "request_hash": fingerprint,
                    "response": row,
                },
            )
