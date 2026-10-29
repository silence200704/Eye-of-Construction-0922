"""Append field observations without changing the alarm assessment or closing it."""

from sqlalchemy.orm import Session
from ....core.errors import AppError
from ..core.serialize import event_out
from ..core.workspace import (
    AuditEntry,
    Workspace,
    bump,
    now_iso,
    require_revision,
    require_role,
    write_audit,
)
from .commands import event_of
from .shared import timeline_item


def authorize(session: Session, workspace: Workspace, event_id: str):
    require_role(workspace, {"safety", "property"}, "预警现场处置")
    return event_of(session, workspace, event_id)


def append(session: Session, workspace: Workspace, event_id: str, payload: dict) -> dict:
    row = authorize(session, workspace, event_id)
    require_revision(payload["expectedRev"], row)
    if row.status == "closed":
        raise AppError("STATE_CONFLICT", "已关闭事件仅供回看，不能追加当前处置", 409)
    at = now_iso()
    action = "现场排查" if payload["kind"] == "investigation" else "处置措施"
    row.timeline = [*row.timeline, timeline_item(at, workspace, action, payload["note"].strip())]
    bump(row, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="record",
            object_id=row.id,
            object_label=row.event_no,
            summary=f"{row.event_no} 登记{action}",
            reason=payload["note"].strip(),
            at=at,
        ),
    )
    return event_out(row)
