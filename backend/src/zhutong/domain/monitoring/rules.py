"""规则与基准的按时间选取，与前端 core/rules.ts 同口径。"""

from .catalog import RULE_METRIC_OF
from .engine import parse_iso


def rule_applies_to(rule: dict, point: dict) -> bool:
    metric = RULE_METRIC_OF.get(point.get("metric", ""))
    if metric is None or not rule.get("enabled", True) or rule.get("metric") != metric:
        return False
    building_ids = rule.get("buildingIds") or []
    if building_ids and point.get("buildingId") not in building_ids:
        return False
    point_ids = rule.get("pointIds") or []
    if point_ids and point.get("id") not in point_ids:
        return False
    return True


def rules_for_point(rules: list[dict], point: dict) -> list[dict]:
    return sorted(
        (rule for rule in rules if rule_applies_to(rule, point)),
        key=lambda rule: rule.get("effectiveFrom", ""),
    )


def rule_for_point(rules: list[dict], point: dict, at: str) -> dict | None:
    moment = parse_iso(at)
    if moment is None:
        return None
    applicable = [
        rule
        for rule in rules
        if rule_applies_to(rule, point)
        and (effective := parse_iso(rule.get("effectiveFrom"))) is not None
        and effective <= moment
    ]
    if not applicable:
        return None
    return max(applicable, key=lambda rule: parse_iso(rule.get("effectiveFrom")) or moment)


def baseline_at_time(baselines: list[dict], point_id: str, at: str) -> dict | None:
    moment = parse_iso(at)
    if moment is None:
        return None
    applicable = [
        row
        for row in baselines
        if row.get("pointId") == point_id
        and (effective := parse_iso(row.get("effectiveFrom"))) is not None
        and effective <= moment
    ]
    if not applicable:
        return None
    return max(applicable, key=lambda row: parse_iso(row.get("effectiveFrom")) or moment)


def snapshot_of(rule: dict) -> dict:
    return {
        "ruleId": rule.get("ruleId", ""),
        "ruleCode": rule.get("code", ""),
        "ruleVersion": rule.get("version", ""),
        "thresholds": dict(rule["thresholds"]) if rule.get("thresholds") is not None else None,
        "unit": rule.get("unit", ""),
        "source": rule.get("source", ""),
    }
