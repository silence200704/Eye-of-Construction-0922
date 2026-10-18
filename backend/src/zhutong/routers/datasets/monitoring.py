"""监测记录、试算与 CSV 路由。"""

from fastapi import APIRouter, Request

from ...operations.datasets.core.workspace import execute_command
from ...operations.datasets.importer import commit_import, preview_import
from ...operations.datasets.records import (
    create_record,
    list_records,
    preview_assessment,
    revise_record,
)
from .common import Current, Read, Write, reply
from .schemas_monitoring import (
    AssessmentPreviewInput,
    ImportCommitInput,
    ImportPreviewInput,
    RecordInput,
    RevisionInput,
)

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}", tags=["监测"])


@router.get("/records")
def records(
    request: Request, session: Read, current: Current, pointId: str | None = None, limit: int = 2000
) -> dict:
    return reply(request, current, list_records(session, current, pointId, limit))


@router.post("/records")
def add_record(request: Request, session: Write, current: Current, body: RecordInput) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        request=request,
        operation="record_write",
        payload=payload,
        handler=lambda: create_record(session, current, payload),
    )
    return reply(request, current, data, data["record"]["rev"], replayed)


@router.post("/records/{record_id}/revisions")
def revise(
    request: Request, session: Write, current: Current, record_id: str, body: RevisionInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        request=request,
        operation="record_revise",
        payload=payload,
        handler=lambda: revise_record(
            session, current, record_id, payload, body.expectedRev, body.reason
        ),
    )
    return reply(request, current, data, data["record"]["rev"], replayed)


@router.post("/assessments/preview")
def assessment_preview(
    request: Request, session: Read, current: Current, body: AssessmentPreviewInput
) -> dict:
    return reply(request, current, preview_assessment(session, current, body.model_dump()))


@router.post("/records/import-preview")
def import_preview(
    request: Request, session: Read, current: Current, body: ImportPreviewInput
) -> dict:
    return reply(request, current, preview_import(session, current, body.csvText))


@router.post("/records/import")
def run_import(request: Request, session: Write, current: Current, body: ImportCommitInput) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        request=request,
        operation="record_import",
        payload=payload,
        handler=lambda: commit_import(session, current, payload),
    )
    return reply(request, current, data, None, replayed)
