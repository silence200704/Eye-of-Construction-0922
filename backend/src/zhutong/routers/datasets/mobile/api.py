from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ....operations.datasets.alarms import field_notes
from ....operations.datasets.core.workspace import Command, execute_command
from ....operations.datasets.mobile import insights, readings, telemetry
from ..common import Current, Read, Write, reply

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}", tags=["原生在线业务"])


@router.get("/mobile/records")
def latest_records(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, readings.latest(session, current))


class SimulationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int
    connection: Literal["online", "offline", "unknown"]
    batteryPercent: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    lastReportAt: str | None = None

    @field_validator("lastReportAt")
    @classmethod
    def timestamp(cls, value: str | None) -> str | None:
        if value is not None:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError("最近上报时间必须带时区")
        return value


class FieldNoteInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    expectedRev: int
    kind: Literal["investigation", "measures"]
    note: str = Field(min_length=10, max_length=4000)


@router.post("/devices/{device_id}/simulation")
def simulate(
    request: Request, session: Write, current: Current, device_id: str, body: SimulationInput
) -> dict:
    telemetry.authorized(session, current, device_id)
    payload = body.model_dump()
    result, replayed = execute_command(
        session,
        current,
        Command(request, "device_simulation", payload),
        lambda: telemetry.update(session, current, device_id, payload),
    )
    return reply(request, current, result, result["rev"], replayed)


@router.post("/events/{event_id}/field-notes")
def append_note(
    request: Request, session: Write, current: Current, event_id: str, body: FieldNoteInput
) -> dict:
    field_notes.authorize(session, current, event_id)
    payload = body.model_dump()
    result, replayed = execute_command(
        session,
        current,
        Command(request, "event_field_note", payload),
        lambda: field_notes.append(session, current, event_id, payload),
    )
    return reply(request, current, result, result["rev"], replayed)


@router.get("/mobile/insights")
def statistics(
    request: Request,
    session: Read,
    current: Current,
    period: Literal["week", "month"] = "week",
    buildingId: str = "",
) -> dict:
    return reply(request, current, insights.summary(session, current, period, buildingId))
