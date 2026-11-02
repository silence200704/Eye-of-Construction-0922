"""巡检/保养周期计算：与前端 core/inspection/taskPlan.ts 同口径。"""

from datetime import UTC, datetime, timedelta, timezone

SHANGHAI = timezone(timedelta(hours=8))


def parse_day(day: str) -> datetime | None:
    try:
        return datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=SHANGHAI)
    except ValueError:
        return None


def valid_day(day: str) -> bool:
    return parse_day(day) is not None


def day_key(at: str) -> str:
    moment = datetime.fromisoformat(at[:-1] + "+00:00" if at.endswith("Z") else at)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(SHANGHAI).strftime("%Y-%m-%d")


def _hit(cycle: dict, start: datetime, target: datetime) -> bool:
    start_day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    target_day = target.replace(hour=0, minute=0, second=0, microsecond=0)
    if target_day < start_day:
        return False
    step = max(1, int(cycle.get("interval", 1)))
    unit = cycle.get("unit")
    if unit == "day":
        return (target_day - start_day).days % step == 0
    if unit == "week":
        return (target_day - start_day).days % (7 * step) == 0
    months = (target_day.year - start_day.year) * 12 + target_day.month - start_day.month
    last = (
        datetime(target_day.year, target_day.month % 12 + 1, 1, tzinfo=SHANGHAI) - timedelta(days=1)
    ).day
    hit_day = min(start_day.day, last)
    return target_day.day == hit_day and months % step == 0


def planned_at(plan: dict, day: str) -> str | None:
    start = parse_day(plan.get("startDate", ""))
    target = parse_day(day)
    if start is None or target is None:
        return None
    end = parse_day(plan.get("endDate") or "") if plan.get("endDate") else None
    if end is not None and target > end:
        return None
    if not _hit(plan.get("cycle") or {}, start, target):
        return None
    at_time = str((plan.get("cycle") or {}).get("atTime", "09:00"))
    try:
        hour, minute = (int(part) for part in at_time.split(":"))
    except ValueError:
        hour, minute = 9, 0
    moment = target.replace(hour=hour, minute=minute, second=0, microsecond=0)
    return moment.astimezone(UTC).isoformat()


def end_of_day(day: str) -> str:
    target = parse_day(day)
    if target is None:
        raise ValueError("日期无效")
    return target.replace(hour=23, minute=59, second=59).astimezone(UTC).isoformat()
