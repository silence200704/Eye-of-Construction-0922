"""预警事件与站内通知路由：状态只经显式命令变化。"""

from fastapi import APIRouter, Request

from ...operations.datasets.alarms import (
    acknowledge_event,
    acknowledge_notification,
    close_event,
    escalate_due,
    list_events,
    list_notifications,
    present_notification,
)
from ...operations.datasets.core.workspace import execute_command
from .common import Current, Read, Write, reply
from .schemas_monitoring import EventCloseInput, EventCommand

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}", tags=["预警"])


@router.get("/events")
def events(request: Request, session: Read, current: Current, status: str = "all") -> dict:
    return reply(request, current, list_events(session, current, status))


@router.get("/notifications")
def notifications(
    request: Request, session: Read, current: Current, eventId: str | None = None
) -> dict:
    return reply(request, current, list_notifications(session, current, eventId))


@router.post("/events/{event_id}/acknowledge")
def acknowledge(
    request: Request, session: Write, current: Current, event_id: str, body: EventCommand
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        request=request,
        operation="event_acknowledge",
        payload=payload,
        handler=lambda: acknowledge_event(session, current, event_id, body.expectedRev),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.post("/events/{event_id}/close")
def close(
    request: Request, session: Write, current: Current, event_id: str, body: EventCloseInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        request=request,
        operation="event_close",
        payload=payload,
        handler=lambda: close_event(
            session, current, event_id, body.expectedRev, body.basis, body.noRepairNote
        ),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.post("/notifications/{notification_id}/present")
def present(request: Request, session: Write, current: Current, notification_id: str) -> dict:
    data, replayed = execute_command(
        session,
        current,
        request=request,
        operation="notification_present",
        payload={},
        handler=lambda: present_notification(session, current, notification_id),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.post("/notifications/{notification_id}/acknowledge")
def acknowledge_note(
    request: Request, session: Write, current: Current, notification_id: str
) -> dict:
    data, replayed = execute_command(
        session,
        current,
        request=request,
        operation="notification_acknowledge",
        payload={},
        handler=lambda: acknowledge_notification(session, current, notification_id),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.post("/notifications/escalate")
def escalate(request: Request, session: Write, current: Current) -> dict:
    data, replayed = execute_command(
        session,
        current,
        request=request,
        operation="notification_escalate",
        payload={},
        handler=lambda: escalate_due(session, current),
    )
    return reply(request, current, data, None, replayed)
