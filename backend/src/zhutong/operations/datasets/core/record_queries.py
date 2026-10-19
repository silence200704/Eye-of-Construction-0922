"""监测记录相关的只读查询，供录入服务与 CSV 预检共用。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....db.models.archive import Point
from ....db.models.monitoring import Baseline, MonitoringRule, MonitorRecord
from .serialize import baseline_out, point_out, record_out, rule_out
from .workspace import Workspace, can_access_building


def rules_for_dataset(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(MonitoringRule).where(MonitoringRule.dataset_id == workspace.dataset_id)
    )
    return [rule_out(row) for row in rows]


def baselines_for_dataset(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(select(Baseline).where(Baseline.dataset_id == workspace.dataset_id))
    return [baseline_out(row) for row in rows]


def records_of_point(session: Session, workspace: Workspace, point_id: str) -> list[MonitorRecord]:
    return list(
        session.scalars(
            select(MonitorRecord)
            .where(
                MonitorRecord.dataset_id == workspace.dataset_id,
                MonitorRecord.point_id == point_id,
            )
            .order_by(MonitorRecord.sample_time.asc())
        )
    )


def point_rows(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(select(Point).where(Point.dataset_id == workspace.dataset_id))
    return [point_out(row) for row in rows if can_access_building(workspace, row.building_id)]


def all_record_rows(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(MonitorRecord).where(MonitorRecord.dataset_id == workspace.dataset_id)
    )
    return [record_out(row) for row in rows]


def context_for_import(session: Session, workspace: Workspace) -> dict[str, Any]:
    return {
        "points": point_rows(session, workspace),
        "rules": rules_for_dataset(session, workspace),
        "baselines": baselines_for_dataset(session, workspace),
        "existing": all_record_rows(session, workspace),
    }
