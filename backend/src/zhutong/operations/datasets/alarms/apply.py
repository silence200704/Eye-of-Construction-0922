"""判定结果落事件：建单、追加、升级、恢复与修订替换。"""

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....db.models.monitoring import AlarmEvent, AlarmNotification
from ....domain.monitoring.engine import parse_iso
from ....domain.monitoring.events import (
    EVENT_LEVEL_LABEL,
    notifications_for,
    plan_event,
    plan_revision,
)
from ...identity_types import ROLES
from ..core.serialize import event_out, record_out
from ..core.workspace import Workspace, bump, now_iso, write_audit


def _actor(workspace: Workspace) -> dict:
    return {
        "name": workspace.actor.name,
        "role": workspace.actor.role,
        "roleLabel": ROLES.get(workspace.actor.role, workspace.actor.role),
    }


def _open_event(
    session: Session, workspace: Workspace, point_id: str, rule_id: str
) -> AlarmEvent | None:
    return session.scalar(
        select(AlarmEvent)
        .where(
            AlarmEvent.dataset_id == workspace.dataset_id,
            AlarmEvent.point_id == point_id,
            AlarmEvent.rule_id == rule_id,
            AlarmEvent.status != "closed",
        )
        .order_by(AlarmEvent.last_trigger_at.desc())
        .limit(1)
    )


def _timeline_item(at: str, workspace: Workspace, action: str, detail: str) -> dict:
    return {"at": at, "by": workspace.actor.name, "action": action, "detail": detail}


def _add_notifications(session: Session, workspace: Workspace, rows: list[dict]) -> None:
    for item in rows:
        session.add(
            AlarmNotification(
                dataset_id=workspace.dataset_id,
                id=item["id"],
                event_id=item["eventId"],
                event_no=item["eventNo"],
                level=item["level"],
                target=item["target"],
                channel=item["channel"],
                created_at=item["createdAt"],
                presented_at=None,
                acknowledged_at=None,
                acknowledged_by="",
                due_minutes=item["dueMinutes"],
                fallback=item["fallback"],
                escalated_at=None,
                escalated_to="",
                escalation_source="",
            )
        )


def _next_event_no(session: Session, workspace: Workspace, sample_time: str) -> str:
    from ..core.workspace import day_key, next_number

    prefix = f"E{day_key(sample_time)}-"
    return next_number(session, AlarmEvent, AlarmEvent.event_no, workspace.dataset_id, prefix)


def _create_event(
    session: Session,
    workspace: Workspace,
    record,
    plan: dict,
    snapshot: dict,
    at: str,
) -> AlarmEvent:
    level = plan["level"]
    evidence = plan["evidence"]
    row = AlarmEvent(
        dataset_id=workspace.dataset_id,
        id=f"evt_{uuid4().hex}",
        event_no=_next_event_no(session, workspace, record.sample_time),
        point_id=record.point_id,
        rule_id=snapshot["ruleId"],
        rule_code=snapshot["ruleCode"],
        level=level,
        peak_level=level,
        status="pending",
        unit=snapshot["unit"],
        opened_at=at,
        opened_by=workspace.actor.name,
        last_trigger_at=record.sample_time,
        last_trigger_value=evidence["triggerValue"],
        evidences=[evidence],
        superseded_evidences=[],
        upgrades=[],
        timeline=[
            _timeline_item(
                at,
                workspace,
                f"生成{EVENT_LEVEL_LABEL[level]}事件",
                _evidence_text(record, evidence, snapshot),
            )
        ],
        acknowledged_at=None,
        acknowledged_by="",
        closed_at=None,
        closed_by="",
        close_basis="",
        note="",
        created_at=at,
        created_by=workspace.actor.name,
        updated_at=at,
        updated_by=workspace.actor.name,
    )
    session.add(row)
    _add_notifications(session, workspace, notifications_for(row.id, row.event_no, level, at))
    write_audit(
        session,
        workspace,
        action="create",
        object_type="record",
        object_id=row.id,
        object_label=row.event_no,
        summary=f"生成{EVENT_LEVEL_LABEL[level]}预警事件 {row.event_no}",
        reason=(
            f"规则 {snapshot['ruleCode']} {snapshot['ruleVersion']}；"
            f"触发值 {evidence['triggerValue']} {snapshot['unit']}"
        ),
        at=at,
    )
    return row


def _evidence_text(record, evidence: dict, snapshot: dict) -> str:
    return (
        f"{record.record_no} 触发值 {evidence['triggerValue']} {snapshot['unit']}；"
        f"规则 {snapshot['ruleCode']} {snapshot['ruleVersion']}"
    )


def _advance_trigger(row: AlarmEvent, record, evidence: dict) -> None:
    current = row.last_trigger_at
    sample = record.sample_time
    if (
        parse_iso(sample) is not None
        and parse_iso(current) is not None
        and parse_iso(sample) > parse_iso(current)
    ):
        row.last_trigger_at = sample
        row.last_trigger_value = evidence["triggerValue"]


def _append_or_upgrade(
    session: Session,
    workspace: Workspace,
    row: AlarmEvent,
    record,
    plan: dict,
    snapshot: dict,
    at: str,
) -> None:
    evidence = plan["evidence"]
    raised = plan["action"] == "upgraded"
    row.level = plan["nextLevel"]
    row.peak_level = plan["nextPeakLevel"]
    _advance_trigger(row, record, evidence)
    row.evidences = [*row.evidences, evidence]
    if plan["upgrade"] is not None:
        row.upgrades = [*row.upgrades, plan["upgrade"]]
    action = f"等级升级为{EVENT_LEVEL_LABEL[row.level]}" if raised else "追加证据"
    detail = _evidence_text(record, evidence, snapshot)
    if not raised:
        detail = (
            f"{record.record_no} 触发值 {evidence['triggerValue']} {snapshot['unit']}，"
            "未超过事件当前等级"
        )
    row.timeline = [*row.timeline, _timeline_item(at, workspace, action, detail)]
    bump(row, workspace, at)
    if plan["notifyLevel"] is not None:
        _add_notifications(
            session, workspace, notifications_for(row.id, row.event_no, plan["notifyLevel"], at)
        )
    write_audit(
        session,
        workspace,
        action="update",
        object_type="record",
        object_id=row.id,
        object_label=row.event_no,
        summary=f"事件 {row.event_no} 升级为{EVENT_LEVEL_LABEL[row.level]}"
        if raised
        else f"事件 {row.event_no} 追加证据",
        reason=f"{record.record_no}；同一点位同一规则未关闭时只追加证据，不重复建单",
        at=at,
    )


def _recover(session: Session, workspace: Workspace, row: AlarmEvent, record, at: str) -> None:
    row.status = "recovering"
    row.timeline = [
        *row.timeline,
        _timeline_item(
            at,
            workspace,
            "进入恢复待确认",
            f"{record.record_no} 连续低于恢复阈值，只改变数据状态，不自动关闭事件",
        ),
    ]
    bump(row, workspace, at)
    write_audit(
        session,
        workspace,
        action="update",
        object_type="record",
        object_id=row.id,
        object_label=row.event_no,
        summary=f"事件 {row.event_no} 转为恢复待确认",
        at=at,
    )


def _apply_revision(
    session: Session,
    workspace: Workspace,
    row: AlarmEvent,
    record,
    plan: dict,
    snapshot: dict,
    reason: str,
    at: str,
) -> None:
    superseded = plan["superseded"]
    active = [item for item in row.evidences if item["recordId"] != record.id]
    if plan["action"] == "replaced":
        active.append(plan["evidence"])
    row.evidences = active
    row.level = plan["nextLevel"] or row.level
    row.peak_level = plan["nextPeakLevel"] or row.peak_level
    row.superseded_evidences = [
        *row.superseded_evidences,
        {
            "evidence": superseded,
            "supersededAt": at,
            "supersededBy": workspace.actor.name,
            "reason": reason,
        },
    ]
    row.timeline = [
        *row.timeline,
        _timeline_item(
            at,
            workspace,
            "修订后撤销证据" if plan["action"] == "withdrawn" else "修订后替换证据",
            f"{record.record_no} 修订后重新判定；原因：{reason}",
        ),
    ]
    bump(row, workspace, at)
    if plan["notifyLevel"] is not None:
        _add_notifications(
            session, workspace, notifications_for(row.id, row.event_no, plan["notifyLevel"], at)
        )
    write_audit(
        session,
        workspace,
        action="revise",
        object_type="record",
        object_id=row.id,
        object_label=row.event_no,
        summary=(
            f"事件 {row.event_no} 在记录修订后撤销一条证据"
            if plan["action"] == "withdrawn"
            else f"事件 {row.event_no} 在记录修订后替换证据"
        ),
        reason=f"{record.record_no}；同一条记录在事件中最多保留一条活跃证据",
        at=at,
    )


def apply_assessment(
    session: Session,
    workspace: Workspace,
    record,
    assessment: dict,
    snapshot: dict | None,
    *,
    revision_reason: str | None = None,
) -> dict:
    if snapshot is None:
        return {
            "action": "none",
            "eventId": "",
            "eventNo": "",
            "message": "该点位没有适用的启用规则，未生成预警事件",
        }
    at = now_iso()
    open_event = _open_event(session, workspace, record.point_id, snapshot["ruleId"])
    if revision_reason is not None and open_event is not None:
        has_evidence = any(item["recordId"] == record.id for item in open_event.evidences)
        if has_evidence:
            plan = plan_revision(
                open_event=event_out(open_event),
                record=record_out(record),
                assessment=assessment,
                snapshot=snapshot,
                actor=_actor(workspace),
                at=at,
                reason=revision_reason,
            )
            if plan["action"] == "none" or plan["superseded"] is None:
                return {"action": "none", "eventId": "", "eventNo": "", "message": ""}
            _apply_revision(
                session, workspace, open_event, record, plan, snapshot, revision_reason, at
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

    plan = plan_event(
        open_event=event_out(open_event) if open_event is not None else None,
        record=record_out(record),
        assessment=assessment,
        snapshot=snapshot,
        actor=_actor(workspace),
        at=at,
    )
    if plan["action"] == "none":
        return {"action": "none", "eventId": "", "eventNo": "", "message": ""}
    if plan["action"] == "recovering" and open_event is not None:
        _recover(session, workspace, open_event, record, at)
        return {
            "action": "recovering",
            "eventId": open_event.id,
            "eventNo": open_event.event_no,
            "message": f"事件 {open_event.event_no} 转为恢复待确认",
        }
    if plan["action"] == "created":
        row = _create_event(session, workspace, record, plan, snapshot, at)
        return {
            "action": "created",
            "eventId": row.id,
            "eventNo": row.event_no,
            "message": f"生成{EVENT_LEVEL_LABEL[row.level]}事件 {row.event_no}",
        }
    if open_event is None:
        return {"action": "none", "eventId": "", "eventNo": "", "message": ""}
    _append_or_upgrade(session, workspace, open_event, record, plan, snapshot, at)
    message = (
        f"事件 {open_event.event_no} 升级为{EVENT_LEVEL_LABEL[open_event.level]}"
        if plan["action"] == "upgraded"
        else f"事件 {open_event.event_no} 追加证据（当前{EVENT_LEVEL_LABEL[open_event.level]}）"
    )
    return {
        "action": plan["action"],
        "eventId": open_event.id,
        "eventNo": open_event.event_no,
        "message": message,
    }
