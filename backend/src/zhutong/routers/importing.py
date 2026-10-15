import json
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..core.errors import AppError
from ..core.http import ok
from ..db.importing.repository import SqlImportRepository
from ..operations.importing.prepare import prepare
from ..operations.importing.types import ImportContext
from .dependencies import Actor

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}/imports", tags=["旧库迁移"])


def repository(request: Request) -> Iterator[SqlImportRepository]:
    with request.app.state.database.sessions() as session:
        yield SqlImportRepository(session)


Repository = Annotated[SqlImportRepository, Depends(repository)]


async def read_package(request: Request) -> dict:
    raw = bytearray()
    async for part in request.stream():
        raw.extend(part)
        if len(raw) > request.app.state.settings.import_max_bytes:
            raise AppError("IMPORT_TOO_LARGE", "迁移包超过体积限制", 413)
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("迁移包必须是对象")
        return payload
    except (ValueError, RecursionError) as error:
        raise AppError("VALIDATION_FAILED", "迁移包 JSON 无效", 422) from error


async def execute(
    request: Request, context: ImportContext, repository: SqlImportRepository, commit: bool
) -> JSONResponse:
    if context.actor.role != "safety" or context.actor.building_ids is not None:
        raise AppError("ROLE_FORBIDDEN", "仅全校范围的安全管理身份可以迁移旧数据", 403)
    plan = prepare(await read_package(request))
    report = repository.execute(context, plan, commit) if plan.report["valid"] else plan.report
    if commit and not report["valid"]:
        raise AppError("IMPORT_INVALID", "迁移预检未通过，未提交任何数据", 422, {"report": report})
    envelope = ok(request, report)
    envelope["replayed"] = report.get("replayed", False)
    return JSONResponse(envelope, status_code=201 if commit and not envelope["replayed"] else 200)


@router.post("/preview")
async def preview(
    request: Request, dataset_id: str, actor: Actor, repository: Repository
) -> JSONResponse:
    return await execute(request, ImportContext(dataset_id, actor), repository, False)


@router.post("")
async def commit(
    request: Request, dataset_id: str, actor: Actor, repository: Repository
) -> JSONResponse:
    return await execute(request, ImportContext(dataset_id, actor), repository, True)


@router.get("/snapshot")
def snapshot(request: Request, dataset_id: str, actor: Actor, repository: Repository) -> dict:
    if actor.role != "safety" or actor.building_ids is not None:
        raise AppError("ROLE_FORBIDDEN", "仅安全管理身份可核对迁移快照", 403)
    return ok(request, repository.snapshot(dataset_id))
