from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ....db.models.monitoring import MonitorRecord
from ..core.serialize import record_out
from ..core.visibility import visible_point_ids
from ..core.workspace import Workspace


def latest(session: Session, workspace: Workspace) -> list[dict]:
    ranked = (
        select(
            MonitorRecord.id,
            func.row_number()
            .over(
                partition_by=MonitorRecord.point_id,
                order_by=(
                    MonitorRecord.sample_time.desc(),
                    MonitorRecord.entered_at.desc(),
                    MonitorRecord.id.desc(),
                ),
            )
            .label("position"),
        )
        .where(
            MonitorRecord.dataset_id == workspace.dataset_id,
            MonitorRecord.point_id.in_(visible_point_ids(workspace)),
        )
        .subquery()
    )
    rows = session.scalars(
        select(MonitorRecord)
        .where(
            MonitorRecord.dataset_id == workspace.dataset_id,
            MonitorRecord.id.in_(select(ranked.c.id).where(ranked.c.position <= 5)),
        )
        .order_by(MonitorRecord.sample_time.asc())
    )
    return [record_out(row) for row in rows]
