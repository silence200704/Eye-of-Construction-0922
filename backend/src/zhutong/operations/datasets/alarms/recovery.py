"""从当前完整有效序列派生恢复条件；不重写历史记录的判定快照。"""

from sqlalchemy.orm import Session

from ....db.models.archive import Point
from ....db.models.monitoring import AlarmEvent
from ....domain.monitoring.engine import assess_record, parse_iso
from ....domain.monitoring.rules import rule_for_point
from ..core.record_queries import records_of_point, rules_for_dataset
from ..core.serialize import point_out, record_out
from ..core.workspace import AuditEntry, Workspace, bump, now_iso, write_audit
from .shared import resume_from_recovery, timeline_item


def current_recovery(session: Session, workspace: Workspace, event: AlarmEvent) -> bool:
    point = session.get(Point, (workspace.dataset_id, event.point_id))
    if point is None:
        return False
    samples = [
        (moment, row)
        for row in records_of_point(session, workspace, point.id)
        if row.quality == "valid" and (moment := parse_iso(row.sample_time)) is not None
    ]
    if not samples:
        return False
    samples.sort(key=lambda item: item[0])
    latest = samples[-1][1]
    candidates = [
        rule for rule in rules_for_dataset(session, workspace) if rule["ruleId"] == event.rule_id
    ]
    rule = rule_for_point(candidates, point_out(point), latest.sample_time)
    if rule is None:
        return False
    assessment = assess_record(
        {
            "rule": rule,
            "point": point_out(point),
            "values": latest.values,
            "baselineValues": latest.baseline_values,
            "quality": latest.quality,
            # 入库质量已包含量程检查；不以设备后来修改的量程重写历史质量。
            "device": None,
            "history": [record_out(row) for _, row in samples],
            "at": latest.sample_time,
        }
    )
    return assessment["state"] == "recovering"


def reconcile_recovery(session: Session, workspace: Workspace, event: AlarmEvent) -> str:
    if event.status == "closed":
        return ""
    recovered = current_recovery(session, workspace, event)
    if recovered == (event.status == "recovering"):
        return ""
    at = now_iso()
    if recovered:
        event.status = "recovering"
        message = "当前有效采样序列满足恢复条件，进入恢复待确认"
        event.timeline = [
            *event.timeline,
            timeline_item(at, workspace, "进入恢复待确认", message),
        ]
    else:
        message = "恢复待确认已被新异常推翻或有效恢复记录不足，请重新复测"
        resume_from_recovery(event, workspace, at, message)
    bump(event, workspace, at)
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="record",
            object_id=event.id,
            object_label=event.event_no,
            summary=f"事件 {event.event_no} 重新核验当前恢复序列",
            reason=message,
            at=at,
        ),
    )
    return message
