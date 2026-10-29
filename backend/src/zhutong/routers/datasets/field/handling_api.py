"""原问题补证与原生工单办理上下文。"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field

from ....operations.datasets.core.workspace import Command, execute_command
from ....operations.field.handling import supplements
from ....operations.field.handling.access import supplement_owner
from ..common import Current, Read, Write, reply
from .schemas import PhotoInput

router = APIRouter()


class SupplementInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    note: str = Field(min_length=10, max_length=4000)
    photos: list[PhotoInput] = Field(default_factory=list, max_length=3)


@router.get("/issues/{issue_id}/supplement-context")
def supplement_context(request: Request, session: Read, current: Current, issue_id: str) -> dict:
    return reply(request, current, supplements.context(session, current, issue_id))


@router.post("/issues/{issue_id}/supplements")
def supplement(
    request: Request, session: Write, current: Current, issue_id: str, body: SupplementInput
) -> dict:
    supplement_owner(session, current, issue_id)
    payload = body.model_dump()
    result, replayed = execute_command(
        session,
        current,
        Command(request, "issue_supplement", payload),
        lambda: supplements.submit(session, current, issue_id, payload),
    )
    return reply(request, current, result, result["issue"]["rev"], replayed)


@router.get("/work-orders/{order_id}/handling-context")
def order_context(request: Request, session: Read, current: Current, order_id: str) -> dict:
    return reply(request, current, supplements.order_context(session, current, order_id))
