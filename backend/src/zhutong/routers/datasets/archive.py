"""档案、基准与规则路由。"""

from fastapi import APIRouter, Request

from ...operations.datasets.archive import (
    ArchiveCommand,
    archive_object,
    list_audits,
    save_building,
    save_floor,
    snapshot,
)
from ...operations.datasets.assets import (
    DeviceWrite,
    PointWrite,
    save_device,
    save_point,
)
from ...operations.datasets.core.workspace import Command, execute_command
from ...operations.datasets.versions import (
    RuleVersionCommand,
    create_rule,
    list_baselines,
    list_rules,
    save_baseline,
    save_rule_version,
)
from .common import Current, Read, Write, reply
from .schemas_archive import (
    ArchiveInput,
    BaselineInput,
    BuildingInput,
    DeviceInput,
    FloorInput,
    PointInput,
    RuleInput,
)

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}", tags=["档案"])


def _run(request: Request, session, current, command: Command, handler) -> dict:
    data, replayed = execute_command(session, current, command, handler)
    return reply(request, current, data, data.get("rev"), replayed)


@router.get("/archive")
def archive_snapshot(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, snapshot(session, current))


@router.get("/audits")
def audit_list(request: Request, session: Read, current: Current, limit: int = 200) -> dict:
    return reply(request, current, list_audits(session, current, limit))


@router.post("/buildings")
def create_building(
    request: Request, session: Write, current: Current, body: BuildingInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: save_building(session, current, payload, None, None),
    )


@router.patch("/buildings/{object_id}")
def update_building(
    request: Request, session: Write, current: Current, object_id: str, body: BuildingInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: save_building(session, current, payload, object_id, body.expectedRev),
    )


@router.post("/floors")
def create_floor(request: Request, session: Write, current: Current, body: FloorInput) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: save_floor(session, current, payload, None, None),
    )


@router.patch("/floors/{object_id}")
def update_floor(
    request: Request, session: Write, current: Current, object_id: str, body: FloorInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: save_floor(session, current, payload, object_id, body.expectedRev),
    )


@router.post("/points")
def create_point(request: Request, session: Write, current: Current, body: PointInput) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: save_point(session, current, PointWrite(payload, None, None)),
    )


@router.patch("/points/{object_id}")
def update_point(
    request: Request, session: Write, current: Current, object_id: str, body: PointInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: save_point(session, current, PointWrite(payload, object_id, body.expectedRev)),
    )


@router.post("/devices")
def create_device(request: Request, session: Write, current: Current, body: DeviceInput) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: save_device(session, current, DeviceWrite(payload, None, None)),
    )


@router.patch("/devices/{object_id}")
def update_device(
    request: Request, session: Write, current: Current, object_id: str, body: DeviceInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: save_device(session, current, DeviceWrite(payload, object_id, body.expectedRev)),
    )


@router.post("/archive/{object_id}/archive")
def archive_endpoint(
    request: Request, session: Write, current: Current, object_id: str, body: ArchiveInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: archive_object(
            session,
            current,
            ArchiveCommand(body.kind, object_id, True, body.reason, body.expectedRev),
        ),
    )


@router.post("/archive/{object_id}/restore")
def restore_endpoint(
    request: Request, session: Write, current: Current, object_id: str, body: ArchiveInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "archive_write", payload),
        lambda: archive_object(
            session,
            current,
            ArchiveCommand(body.kind, object_id, False, body.reason, body.expectedRev),
        ),
    )


@router.get("/baselines")
def baselines(
    request: Request, session: Read, current: Current, pointId: str | None = None
) -> dict:
    return reply(request, current, list_baselines(session, current, pointId))


@router.post("/baselines")
def create_baseline(
    request: Request, session: Write, current: Current, body: BaselineInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "baseline_write", payload),
        lambda: save_baseline(session, current, payload),
    )


@router.get("/rules")
def rules(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, list_rules(session, current))


@router.post("/rules")
def create_rule_endpoint(
    request: Request, session: Write, current: Current, body: RuleInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "rule_write", payload),
        lambda: create_rule(session, current, payload),
    )


@router.post("/rules/{rule_id}/versions")
def rule_version(
    request: Request, session: Write, current: Current, rule_id: str, body: RuleInput
) -> dict:
    payload = body.model_dump()
    return _run(
        request,
        session,
        current,
        Command(request, "rule_write", payload),
        lambda: save_rule_version(
            session,
            current,
            RuleVersionCommand(rule_id, payload, body.expectedRev, body.expectedVersion),
        ),
    )
