from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....db.models.archive import Building, Point
from ....db.models.monitoring import AlarmEvent, MonitorRecord
from ..core.workspace import Workspace, can_access_building, require_building

SHANGHAI = timezone(timedelta(hours=8))


def day(value: str) -> str:
    try:
        return (
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            .astimezone(SHANGHAI)
            .date()
            .isoformat()
        )
    except (ValueError, AttributeError):
        return ""


def summary(session: Session, workspace: Workspace, period: str, building_id: str) -> dict:
    if building_id:
        require_building(workspace, building_id)
    days = 7 if period == "week" else 30
    end = datetime.now(SHANGHAI).date()
    dates = [(end - timedelta(days=n)).isoformat() for n in reversed(range(days))]
    points = {
        r.id: r
        for r in session.scalars(select(Point).where(Point.dataset_id == workspace.dataset_id))
        if can_access_building(workspace, r.building_id)
        and (not building_id or r.building_id == building_id)
    }
    buildings = {
        r.id: r.name
        for r in session.scalars(
            select(Building).where(Building.dataset_id == workspace.dataset_id)
        )
        if can_access_building(workspace, r.id) and (not building_id or r.id == building_id)
    }
    events = [
        r
        for r in session.scalars(
            select(AlarmEvent).where(AlarmEvent.dataset_id == workspace.dataset_id)
        )
        if r.point_id in points and day(r.opened_at) in dates
    ]
    records = [
        r
        for r in session.scalars(
            select(MonitorRecord).where(MonitorRecord.dataset_id == workspace.dataset_id)
        )
        if r.point_id in points and day(r.sample_time) in dates
    ]
    trend = Counter(day(r.opened_at) for r in events)
    by_point = Counter(r.point_id for r in events)
    by_building = Counter(points[r.point_id].building_id for r in events)
    types = Counter(
        r.type
        for r in points.values()
        if r.status == "active" and r.type in {"crack", "tilt", "vibration"}
    )
    return {
        "period": period,
        "startDate": dates[0],
        "endDate": dates[-1],
        "timeZone": "Asia/Shanghai",
        "source": "simulation",
        "totalEvents": len(events),
        "recordCount": len(records),
        "openEvents": sum(r.status != "closed" for r in events),
        "trend": [{"date": date, "count": trend[date]} for date in dates],
        "byBuilding": [
            {"id": key, "label": name, "count": by_building[key]} for key, name in buildings.items()
        ],
        "byPoint": [
            {"id": key, "label": r.name, "count": by_point[key]} for key, r in points.items()
        ],
        "sensorTypes": [
            {"id": key, "label": key, "count": count} for key, count in sorted(types.items())
        ],
    }
