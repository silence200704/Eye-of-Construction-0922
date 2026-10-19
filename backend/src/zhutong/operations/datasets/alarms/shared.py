"""事件写入共用的小工具：时间线、通知、恢复退回与当前记录判断。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....db.models.monitoring import AlarmEvent, AlarmNotification, MonitorRecord
from ....domain.monitoring.engine import parse_iso
from ..core.workspace import Workspace


def timeline_item(at: str, workspace: Workspace, action: str, detail: str) -> dict:
    return {"at": at, "by": workspace.actor.name, "action": action, "detail": detail}


def add_notifications(session: Session, workspace: Workspace, rows: list[dict]) -> None:
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


def resume_from_recovery(row: AlarmEvent, workspace: Workspace, at: str) -> bool:
    """恢复待确认被新异常推翻：回到确认前/后的状态，不能沿用恢复状态。"""
    if row.status != "recovering":
        return False
    next_status = "handling" if row.acknowledged_at is not None else "pending"
    label = "处理中" if next_status == "handling" else "待确认"
    row.status = next_status
    row.timeline = [
        *row.timeline,
        timeline_item(
            at,
            workspace,
            "恢复状态被新异常推翻",
            f"新读数再次越限，事件退回{label}；恢复待确认不再成立",
        ),
    ]
    return True


def is_current_record(session: Session, workspace: Workspace, record) -> bool:
    """历史补录/历史修订不能改变当前事件状态：只允许最新有效采样时刻驱动事件。"""
    current = parse_iso(record.sample_time)
    if current is None:
        return True
    rows = session.execute(
        select(MonitorRecord.sample_time, MonitorRecord.quality).where(
            MonitorRecord.dataset_id == workspace.dataset_id,
            MonitorRecord.point_id == record.point_id,
        )
    ).all()
    valid = [
        moment for value, quality in rows if quality == "valid" and (moment := parse_iso(value))
    ]
    pool = valid or [moment for value, _ in rows if (moment := parse_iso(value))]
    return not pool or current >= max(pool)
