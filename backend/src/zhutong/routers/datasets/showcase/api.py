"""纯软件比赛演示入口，所有准备通过既有领域命令。"""

from dataclasses import replace
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy import select

from ....core.errors import AppError
from ....db.models.foundation import OperationReceipt
from ....operations.datasets.core.workspace import (
    Command,
    command_key,
    execute_command,
    request_digest,
)
from ....operations.showcase import service
from ....operations.showcase.samples import sample
from ..common import Current, Read, Write, reply

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}/showcase", tags=["比赛演示"])


class ResetInput(BaseModel):
    confirmDataset: Literal["demo-showcase"]


class SampleInput(BaseModel):
    sensor: Literal["crack", "tilt", "vibration"]
    level: Literal["normal", "yellow", "orange", "red"]


@router.get("/status")
def status(request: Request, session: Read, current: Current):
    return reply(request, current, service.status(session, current))


@router.post("/reset")
def reset(request: Request, session: Write, current: Current, body: ResetInput):
    service.authorize(current)
    key = command_key(request)
    payload = body.model_dump()
    digest = request_digest(
        {
            "method": request.method,
            "path": request.url.path,
            "operation": "showcase_reset",
            "payload": payload,
        }
    )
    existing = session.scalar(
        select(OperationReceipt).where(
            OperationReceipt.dataset_id == current.dataset_id,
            OperationReceipt.actor_id == current.actor.id,
            OperationReceipt.operation == "showcase_reset",
            OperationReceipt.key == key,
        )
    )
    if existing:
        if existing.request_hash != digest:
            raise AppError("IDEMPOTENCY_CONFLICT", "同一复位键的内容不同", 409)
        return reply(request, current, existing.response, replayed=True)
    result, replayed = execute_command(
        session,
        current,
        Command(request, "showcase_reset", payload),
        lambda: service.reset(session, current),
    )
    return reply(request, replace(current, epoch=result["epoch"]), result, replayed=replayed)


@router.post("/prepare")
@router.post("/pause")
@router.post("/resume")
def act(request: Request, session: Write, current: Current):
    action = request.url.path.rsplit("/", 1)[-1]
    service.authorize(current)
    result, replayed = execute_command(
        session,
        current,
        Command(request, "showcase_" + action, {}),
        lambda: service.action(session, current, action),
    )
    return reply(request, current, result, replayed=replayed)


@router.post("/sample")
def sample_input(request: Request, session: Write, current: Current, body: SampleInput):
    service.authorize(current)
    payload = body.model_dump()
    result, replayed = execute_command(
        session,
        current,
        Command(request, "showcase_sample", payload),
        lambda: sample(session, current, payload),
    )
    return reply(request, current, result, replayed=replayed)
