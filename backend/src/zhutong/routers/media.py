from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from ..core.errors import AppError
from ..core.http import ok
from ..db.media import SqlMediaRepository
from ..operations.datasets.core.workspace import dataset_epoch
from ..operations.media.attachments import link_attachment
from ..operations.media.service import MediaService
from ..operations.media.types import AttachmentSpec, MediaContext, UploadSpec
from ..storage.files import FileStore
from .dependencies import Actor
from .media_schemas import AttachmentInput, UploadQuery

router = APIRouter(prefix="/api/v1", tags=["数据集与媒体"])


def media_repository(request: Request) -> Iterator[SqlMediaRepository]:
    with request.app.state.database.sessions() as session:
        yield SqlMediaRepository(session)


Repository = Annotated[SqlMediaRepository, Depends(media_repository)]


def binaries(request: Request) -> FileStore:
    settings = request.app.state.settings
    return FileStore(settings.runtime_dir / "media", settings.media_max_bytes)


@router.get("/datasets")
def datasets(request: Request, actor: Actor, repository: Repository) -> dict:
    return ok(request, repository.datasets())


@router.post("/datasets/{dataset_id}/media")
async def upload(
    request: Request,
    dataset_id: str,
    query: Annotated[UploadQuery, Query()],
    actor: Actor,
    repository: Repository,
) -> JSONResponse:
    key = request.headers.get("Idempotency-Key")
    if key is not None and (not key.strip() or len(key) > 160):
        raise AppError("VALIDATION_FAILED", "上传幂等标识长度无效", 422)
    spec = UploadSpec(
        file_name=query.fileName,
        mime_type=request.headers.get("Content-Type", "").split(";")[0].lower(),
        point_id=query.pointId,
        origin=query.origin,
        draft_key=key,
        captured_at=query.capturedAt,
        expected_epoch=dataset_epoch(request) if "X-Dataset-Epoch" in request.headers else None,
    )
    record, replayed = await MediaService(repository, binaries(request)).upload(
        MediaContext(dataset_id, actor), spec, request.stream()
    )
    envelope = ok(request, record.public())
    envelope["replayed"] = replayed
    return JSONResponse(envelope, status_code=200 if replayed else 201)


@router.get("/datasets/{dataset_id}/media/{file_id}")
def metadata(
    request: Request, dataset_id: str, file_id: str, actor: Actor, repository: Repository
) -> dict:
    record = MediaService(repository, binaries(request)).read(
        MediaContext(dataset_id, actor), file_id
    )
    return ok(request, record.public())


@router.get("/datasets/{dataset_id}/media/{file_id}/content")
def content(
    request: Request, dataset_id: str, file_id: str, actor: Actor, repository: Repository
) -> FileResponse:
    store = binaries(request)
    record = MediaService(repository, store).read(MediaContext(dataset_id, actor), file_id)
    response = FileResponse(
        store.checked_path(record),
        media_type=record.mime_type,
        filename=record.file_name,
        content_disposition_type="inline",
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "private, no-store"
    return response


@router.post("/datasets/{dataset_id}/attachments")
def attach(
    request: Request, dataset_id: str, body: AttachmentInput, actor: Actor, repository: Repository
) -> JSONResponse:
    spec = AttachmentSpec(
        media_id=body.mediaId,
        draft_id=body.draftId,
        kind=body.kind,
        thumb_id=body.thumbId,
        issue_id=body.issueId,
        work_order_id=body.workOrderId,
        maintenance_task_id=body.maintenanceTaskId,
    )
    result, replayed = link_attachment(repository, MediaContext(dataset_id, actor), spec)
    envelope = ok(request, result)
    envelope["replayed"] = replayed
    return JSONResponse(envelope, status_code=200 if replayed else 201)
