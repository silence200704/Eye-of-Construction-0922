"""规则与基准的按时间选取，与前端 core/rules.ts 同口径。"""

from .catalog import RULE_METRIC_OF
from .engine import parse_iso


def rule_applies_to(rule: dict, point: dict) -> bool:
    metric = RULE_METRIC_OF.get(point.get("metric", ""))
    # 启停由判定引擎处理；先按时间选出当时生效的版本，停用不能被"回退到旧版本"绕过。
    if metric is None or rule.get("metric") != metric:
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


def _identity(rule: dict) -> str:
    return str(rule.get("ruleId") or rule.get("id") or "")


def _latest_versions(rules: list[dict], moment) -> list[dict]:
    """每个稳定 ruleId 先确定当时有效版本，再做范围/指标判断。

    最新版本排除某楼栋/测点或停用时，不能回退到同一 ruleId 的旧版本；
    不同 ruleId 的独立规则仍各自保留。
    """
    latest: dict[str, tuple[object, dict]] = {}
    for rule in rules:
        effective = parse_iso(rule.get("effectiveFrom"))
        if effective is None or effective > moment:
            continue
        key = _identity(rule)
        if key not in latest or effective >= latest[key][0]:
            latest[key] = (effective, rule)
    return [rule for _, rule in latest.values()]


def rule_for_point(rules: list[dict], point: dict, at: str) -> dict | None:
    moment = parse_iso(at)
    if moment is None:
        return None
    applicable = [rule for rule in _latest_versions(rules, moment) if rule_applies_to(rule, point)]
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
