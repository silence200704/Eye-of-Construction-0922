"""动态业务事实：直接读当前数据库，不用内存快照回答"现在怎样"。

每个函数返回 (conclusion, facts, evidence, extras)；extras 携带趋势样本等结构化数据。
读取按 workspace 身份过滤楼栋范围；行版本随对象一起返回，供回答标注查询时刻。
"""

from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.models.archive import Building, Device, Floor, Point
from ...db.models.field import Issue
from ...db.models.monitoring import AlarmEvent, Baseline, MonitoringRule, MonitorRecord
from ...domain.monitoring.rules import rule_for_point
from ..datasets.core.record_queries import records_of_point, rules_for_dataset
from ..datasets.core.serialize import point_out
from ..datasets.core.workspace import Workspace
from .resolve import Resolved

LOCAL = timezone(timedelta(hours=8))


def _local(at: str | None) -> str:
    if not at:
        return ""
    try:
        moment = datetime.fromisoformat(at[:-1] + "+00:00" if at.endswith("Z") else at)
    except ValueError:
        return at
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(LOCAL).strftime("%Y-%m-%d %H:%M")


def queried_at() -> str:
    return datetime.now(UTC).isoformat()


def _freshness(sample_time: str | None, now: datetime) -> tuple[str, str]:
    if not sample_time:
        return "none", "该测点还没有有效读数"
    try:
        moment = datetime.fromisoformat(
            sample_time[:-1] + "+00:00" if sample_time.endswith("Z") else sample_time
        )
    except ValueError:
        return "stale", "采样时间无法解析"
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    hours = (now - moment).total_seconds() / 3600
    if hours <= 2:
        return "current", f"采样于 {_local(sample_time)}（约 {max(0.0, hours):.1f} 小时前）"
    return "stale", f"采样于 {_local(sample_time)}（约 {hours:.0f} 小时前），该去看看"


def _value_of(record: MonitorRecord) -> tuple[str, str]:
    values = record.values or {}
    if not values:
        return "", record.unit or ""
    key = next(iter(values))
    raw = values[key]
    text = f"{raw:g}" if isinstance(raw, (int, float)) else str(raw)
    return text, record.unit or ""


def _latest_record(session: Session, workspace: Workspace, point_id: str) -> MonitorRecord | None:
    rows = [row for row in records_of_point(session, workspace, point_id) if row.quality == "valid"]
    if not rows:
        return None
    return max(rows, key=lambda row: row.sample_time)


def _open_events_of(session: Session, workspace: Workspace, point_id: str) -> list[AlarmEvent]:
    rows = session.scalars(
        select(AlarmEvent).where(
            AlarmEvent.dataset_id == workspace.dataset_id,
            AlarmEvent.point_id == point_id,
            AlarmEvent.status != "closed",
        )
    )
    return sorted(rows, key=lambda row: row.last_trigger_at or "", reverse=True)


def _open_event_of(session: Session, workspace: Workspace, point_id: str) -> AlarmEvent | None:
    events = _open_events_of(session, workspace, point_id)
    return events[0] if events else None


def _rule_of(
    session: Session, workspace: Workspace, point: Point, at: str
) -> MonitoringRule | None:
    """当前生效规则复用阶段 4 选取器；同一 ruleId 最新版停用时不回退旧版。"""
    if not point.metric:
        return None
    rule = rule_for_point(rules_for_dataset(session, workspace), point_out(point), at)
    if rule is None or not rule.get("enabled", False):
        return None
    return session.get(MonitoringRule, (workspace.dataset_id, rule["id"]))


def _baseline_of(session: Session, workspace: Workspace, point_id: str) -> Baseline | None:
    rows = session.scalars(
        select(Baseline).where(
            Baseline.dataset_id == workspace.dataset_id,
            Baseline.point_id == point_id,
            Baseline.current.is_(True),
        )
    )
    return next(iter(rows), None)


LEVEL_TEXT = {"yellow": "黄色关注", "orange": "橙色介入", "red": "红色紧急核查"}
STATUS_TEXT = {
    "pending": "待确认",
    "handling": "处理中",
    "recovering": "恢复待确认",
    "closed": "已关闭",
}


def point_status(
    session: Session, workspace: Workspace, resolved: Resolved, point: Point, now: datetime
) -> dict:
    record = _latest_record(session, workspace, point.id)
    open_events = _open_events_of(session, workspace, point.id)
    event = open_events[0] if len(open_events) == 1 else None
    if event is not None and resolved.event_id is None:
        resolved.event_id = event.id
    rule = _rule_of(session, workspace, point, queried_at())
    baseline = _baseline_of(session, workspace, point.id)
    device = session.scalar(
        select(Device).where(Device.dataset_id == workspace.dataset_id, Device.point_id == point.id)
    )
    freshness, freshness_label = _freshness(record.sample_time if record else None, now)
    facts = [
        {"label": "测点", "value": f"{point.code} {point.name}", "unit": ""},
        {"label": "位置", "value": _location(session, point), "unit": ""},
    ]
    evidence: list[dict] = []
    conclusion: str
    if record is None:
        conclusion = f"{point.name}还没有有效读数，不能下结论；请先录入监测记录。"
        facts.append({"label": "有效读数", "value": "（无）", "unit": ""})
    else:
        value, unit = _value_of(record)
        facts.append({"label": "当前读数", "value": value, "unit": unit})
        facts.append(
            {
                "label": "数据质量",
                "value": "有效" if record.quality == "valid" else record.quality,
                "unit": "",
            }
        )
        if baseline is not None and record.baseline_values:
            base = next(iter(record.baseline_values.values()))
            current = next(iter(record.values.values()))
            if isinstance(base, (int, float)) and isinstance(current, (int, float)):
                facts.append(
                    {
                        "label": "相对基准",
                        "value": f"{current - base:+.3g}",
                        "unit": unit,
                    }
                )
        evidence.append(
            {
                "kind": "record",
                "ref": record.record_no,
                "id": record.id,
                "detail": (
                    f"采样 {_local(record.sample_time)}；录入 {_local(record.created_at)}；"
                    f"修订 {record.record_revision} 次"
                ),
            }
        )
    if rule is not None:
        facts.append({"label": "适用规则", "value": f"{rule.code}（{rule.version}）", "unit": ""})
    if event is not None:
        level = LEVEL_TEXT.get(event.level, event.level)
        facts.append(
            {
                "label": "未关闭事件",
                "value": (
                    f"{event.event_no}（{level}，{STATUS_TEXT.get(event.status, event.status)}）"
                ),
                "unit": "",
            }
        )
        evidence.append(
            {
                "kind": "event",
                "ref": event.event_no,
                "id": event.id,
                "detail": f"最近触发 {_local(event.last_trigger_at)}",
            }
        )
    elif len(open_events) > 1:
        facts.append(
            {"label": "未关闭事件", "value": f"{len(open_events)} 条（追问需选择）", "unit": ""}
        )
    else:
        facts.append({"label": "未关闭事件", "value": "无", "unit": ""})
    issue = _open_issue_of(session, workspace, point.id)
    if issue is not None:
        facts.append(
            {"label": "在办问题", "value": f"{issue.issue_no}（{issue.status}）", "unit": ""}
        )
    current = facts[2]["value"] if record is not None else "（无）"
    unit = facts[2]["unit"] if record is not None and facts[2]["unit"] else ""
    conclusion = f"{point.name}当前读数 {current}{unit}；{freshness_label}。"
    extras = {
        "freshness": freshness,
        "freshnessLabel": freshness_label,
        "queriedAt": queried_at(),
        "device": device.name if device else "",
    }
    if rule is not None:
        extras["rule"] = {"id": rule.id, "ruleId": rule.rule_id, "version": rule.version}
    if baseline is not None:
        extras["baseline"] = {"version": baseline.version}
    return {
        "conclusion": conclusion,
        "facts": facts,
        "evidence": evidence,
        "extras": extras,
    }


def _location(session: Session, point: Point) -> str:
    building = session.get(Building, (point.dataset_id, point.building_id))
    floor = session.get(Floor, (point.dataset_id, point.floor_id))
    parts = [
        building.name if building else "",
        f"{floor.floor_no}层" if floor else "",
        point.zone_id or "",
    ]
    return " ".join(part for part in parts if part)


def _open_issue_of(session: Session, workspace: Workspace, point_id: str) -> Issue | None:
    rows = session.scalars(
        select(Issue).where(
            Issue.dataset_id == workspace.dataset_id,
            Issue.point_id == point_id,
            Issue.status != "closed",
        )
    )
    ordered = sorted(rows, key=lambda row: row.created_at, reverse=True)
    return ordered[0] if ordered else None
