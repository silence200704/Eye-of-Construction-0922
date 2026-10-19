"""记录修订驱动的事件处理：活跃证据替换、当前记录重判与关闭后历史修订。"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....db.models.monitoring import AlarmEvent
from ....domain.monitoring.events import (
    EVENT_LEVEL_LABEL,
    RevisionPlanInput,
    notifications_for,
    plan_revision,
)
from ...identity_types import ROLES
from ..core.serialize import event_out, record_out
from ..core.workspace import AuditEntry, Workspace, bump, now_iso, write_audit
from .shared import add_notifications, is_current_record, timeline_item


@dataclass(frozen=True)
class RevisionSeed:
    row: AlarmEvent
    record: Any
    plan: dict
    reason: str
    at: str


def _has_evidence(event: AlarmEvent, record_id: str) -> bool:
    if any(item["recordId"] == record_id for item in event.evidences or []):
        return True
    return any(
        item["evidence"]["recordId"] == record_id for item in event.superseded_evidences or []
    )


def _closed_event_has_evidence(session: Session, workspace: Workspace, record) -> bool:
    rows = session.scalars(
        select(AlarmEvent).where(
            AlarmEvent.dataset_id == workspace.dataset_id,
            AlarmEvent.point_id == record.point_id,
            AlarmEvent.status == "closed",
        )
    )
    return any(_has_evidence(row, record.id) for row in rows)


def _apply_revision(session: Session, workspace: Workspace, seed: RevisionSeed) -> None:
    plan = seed.plan
    row = seed.row
    superseded = plan["superseded"]
    active = [item for item in row.evidences if item["recordId"] != seed.record.id]
    if plan["action"] == "replaced":
        active.append(plan["evidence"])
    row.evidences = active
    row.level = plan["nextLevel"] or row.level
    row.peak_level = plan["nextPeakLevel"] or row.peak_level
    row.superseded_evidences = [
        *row.superseded_evidences,
        {
            "evidence": superseded,
            "supersededAt": seed.at,
            "supersededBy": workspace.actor.name,
            "reason": seed.reason,
        },
    ]
    row.timeline = [
        *row.timeline,
        timeline_item(
            seed.at,
            workspace,
            "修订后撤销证据" if plan["action"] == "withdrawn" else "修订后替换证据",
            f"{seed.record.record_no} 修订后重新判定；原因：{seed.reason}",
        ),
    ]
    bump(row, workspace, seed.at)
    if plan["notifyLevel"] is not None:
        add_notifications(
            session,
            workspace,
            notifications_for(row.id, row.event_no, plan["notifyLevel"], seed.at),
        )
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="revise",
            object_type="record",
            object_id=row.id,
            object_label=row.event_no,
            summary=(
                f"事件 {row.event_no} 在记录修订后撤销一条证据"
                if plan["action"] == "withdrawn"
                else f"事件 {row.event_no} 在记录修订后替换证据"
            ),
            reason=f"{seed.record.record_no}；同一条记录在事件中最多保留一条活跃证据",
            at=seed.at,
        ),
    )


def revision_flow(
    session: Session,
    workspace: Workspace,
    command: Any,
    open_event: AlarmEvent | None,
) -> dict | None:
    """返回 None 表示当前记录需要继续走普通建单/升级/恢复流程。"""
    record = command.record
    if open_event is not None and _has_evidence(open_event, record.id):
        at = now_iso()
        plan = plan_revision(
            RevisionPlanInput(
                open_event=event_out(open_event),
                record=record_out(record),
                assessment=command.assessment,
                snapshot=command.snapshot or {},
                actor={
                    "name": workspace.actor.name,
                    "role": workspace.actor.role,
                    "roleLabel": ROLES.get(workspace.actor.role, workspace.actor.role),
                },
                at=at,
                reason=command.revision_reason or "",
            )
        )
        if plan["action"] == "none" or plan["superseded"] is None:
            return {"action": "none", "eventId": "", "eventNo": "", "message": ""}
        _apply_revision(
            session,
            workspace,
            RevisionSeed(
                row=open_event,
                record=record,
                plan=plan,
                reason=command.revision_reason or "",
                at=at,
            ),
        )
        message = (
            f"事件 {open_event.event_no} 已撤销该记录的越限证据，仍在等待处置"
            if plan["action"] == "withdrawn"
            else (
                f"事件 {open_event.event_no} 已按修订后的判定更新为"
                f"{EVENT_LEVEL_LABEL[open_event.level]}"
            )
        )
        return {
            "action": "appended" if plan["action"] == "withdrawn" else "upgraded",
            "eventId": open_event.id,
            "eventNo": open_event.event_no,
            "message": message,
        }

    if _closed_event_has_evidence(session, workspace, record):
        return {
            "action": "none",
            "eventId": "",
            "eventNo": "",
            "message": "事件已关闭；历史修订只更新记录，不新建事件",
        }
    if not is_current_record(session, workspace, record):
        return {
            "action": "none",
            "eventId": "",
            "eventNo": "",
            "message": "历史修订不改变当前事件状态",
        }
    return None
