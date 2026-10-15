import base64
import hashlib
from dataclasses import asdict

from ...core.errors import AppError
from ..media.types import BinaryStore
from .prepare import digest, problem
from .types import ImportContext, ImportPlan


async def chunks(data: bytes):
    yield data


async def prepare_file(
    store: BinaryStore, context: ImportContext, plan: ImportPlan, item: dict
) -> str:
    raw, field_name, group = item["raw"], item["field"], item["group"]
    encoded = raw.get(field_name)
    if not isinstance(encoded, str) or ";base64," not in encoded or not encoded.startswith("data:"):
        raise ValueError(f"{field_name} 字节缺失或已损坏，无法从空对象恢复")
    header, body = encoded.split(",", 1)
    mime = header[5:].split(";")[0]
    data = base64.b64decode(body, validate=True)
    if mime != raw.get("mimeType", mime) and field_name == "blob":
        raise ValueError("原图片声明类型与字节类型不一致")
    stored = await store.put(chunks(data), mime)
    plan.file_keys.append(stored.storage_key)
    stable = hashlib.sha256(
        f"{plan.source_name}/{group}/{raw['id']}/{field_name}".encode()
    ).hexdigest()[:40]
    identifier = "legacy-file-" + stable
    clean = {key: value for key, value in raw.items() if key not in {"blob", "thumb", "analysis"}}
    clean["bytesSha256"] = stored.sha256
    values = {
        **asdict(stored),
        "id": identifier,
        "dataset_id": context.dataset_id,
        "file_name": raw.get("fileName", raw["id"]),
        "point_id": raw.get("pointId") or None,
        "origin": raw.get("origin", "upload"),
        "draft_key": None,
        "captured_at": raw.get("capturedAt"),
        "uploaded_at": raw.get("uploadedAt", raw.get("capturedAt", "")),
        "uploaded_by": context.actor.id,
        "legacy_payload": clean,
    }
    plan.binary_rows.append(("media_files", values))
    plan.report["filesVerified"] += 1
    return identifier


async def prepare_files(store: BinaryStore, context: ImportContext, plan: ImportPlan) -> None:
    for raw in plan.data["attachments"]:
        try:
            media_id = await prepare_file(
                store, context, plan, {"raw": raw, "field": "blob", "group": "attachments"}
            )
            thumb_id = await prepare_file(
                store, context, plan, {"raw": raw, "field": "thumb", "group": "attachments"}
            )
            clean = {key: value for key, value in raw.items() if key not in {"blob", "thumb"}}
            clean.update(
                blobSha256=plan.binary_rows[-2][1]["sha256"],
                thumbSha256=plan.binary_rows[-1][1]["sha256"],
            )
            values = {
                "dataset_id": context.dataset_id,
                "id": raw["id"],
                "media_id": media_id,
                "thumb_id": thumb_id,
                "issue_id": raw.get("issueId") or None,
                "work_order_id": raw.get("workOrderId") or None,
                "maintenance_task_id": raw.get("maintenanceTaskId") or None,
                "kind": raw["kind"],
                "draft_id": raw.get("draftId") or "legacy-" + digest(raw["id"]),
                "legacy_payload": clean,
            }
            plan.binary_rows.append(("attachments", values))
        except (ValueError, KeyError, AppError) as error:
            plan.report["errors"].append(problem("attachments", raw["id"], str(error)))
    await prepare_runtime_media(store, context, plan)


async def prepare_runtime_media(
    store: BinaryStore, context: ImportContext, plan: ImportPlan
) -> None:
    video = plan.runtime.get("video")
    if video:
        try:
            meta = {
                **video["meta"],
                "blob": video["blob"],
                "mimeType": "video/mp4",
                "origin": video.get("origin", "upload"),
            }
            media_id = await prepare_file(
                store, context, plan, {"raw": meta, "field": "blob", "group": "video"}
            )
            if meta.get("pointId"):
                plan.binary_rows.append(
                    (
                        "media_videos",
                        {
                            "dataset_id": context.dataset_id,
                            "id": meta["id"],
                            "media_id": media_id,
                            "point_id": meta["pointId"],
                            "metadata_snapshot": video["meta"],
                            "analysis": video.get("analysis"),
                        },
                    )
                )
            plan.runtime["video"] = {
                "meta": video["meta"],
                "analysis": video.get("analysis"),
                "mediaId": media_id,
            }
        except (ValueError, KeyError, AppError) as error:
            plan.report["errors"].append(problem("video", "", str(error)))
    for group in ("assets", "frames"):
        for raw in plan.runtime.get(group, []):
            try:
                media_id = await prepare_file(
                    store, context, plan, {"raw": raw, "field": "blob", "group": group}
                )
                if group == "frames":
                    plan.binary_rows.append(
                        (
                            "media_frames",
                            {
                                "dataset_id": context.dataset_id,
                                "id": raw["id"],
                                "media_id": media_id,
                                "point_id": raw["pointId"],
                                "video_id": raw.get("videoId") or None,
                                "time_code": raw.get("timeCode"),
                                "label": raw["label"],
                                "captured_at": raw["capturedAt"],
                                "legacy_payload": {
                                    key: value for key, value in raw.items() if key != "blob"
                                },
                            },
                        )
                    )
            except (ValueError, KeyError, AppError) as error:
                plan.report["errors"].append(problem(group, raw.get("id", ""), str(error)))
    for raw in plan.runtime.get("comparisons", []):
        plan.binary_rows.append(
            (
                "media_comparisons",
                {
                    "dataset_id": context.dataset_id,
                    "id": "legacy-compare-" + digest(raw)[:40],
                    "point_id": raw["pointId"],
                    "before_id": raw["beforeId"],
                    "after_id": raw["afterId"],
                    "result": raw,
                },
            )
        )
