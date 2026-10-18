"""判定值计算：与前端 core/assess/trigger.ts 逐条同口径。"""

from typing import Any

Number = int | float


def number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def round_trigger(value: float) -> float:
    return round(value * 1e6) / 1e6


def trigger_of(rule: dict, values: dict, baseline_values: dict | None) -> dict:
    none = {"value": None, "signed": None, "baseline": None, "basis": ""}
    metric = rule.get("metric")

    if metric == "crack_width":
        fixed = (rule.get("fixedBaseline") or {}).get("width")
        base = (
            (baseline_values or {}).get("width") if rule.get("baselineSource") == "point" else fixed
        )
        value = number(values.get("width"))
        if base is None or value is None:
            return none
        delta = round_trigger(value - float(base))
        return {
            "value": abs(delta),
            "signed": delta,
            "baseline": float(base),
            "basis": "相对基准变化量绝对值",
        }

    if metric == "tilt_xy":
        fixed = rule.get("fixedBaseline") or {}
        source = rule.get("baselineSource")
        base_x = (baseline_values or {}).get("angleX") if source == "point" else fixed.get("angleX")
        base_y = (baseline_values or {}).get("angleY") if source == "point" else fixed.get("angleY")
        candidates = []
        value_x = number(values.get("angleX"))
        value_y = number(values.get("angleY"))
        if base_x is not None and value_x is not None:
            delta_x = round_trigger(value_x - float(base_x))
            candidates.append({"abs": abs(delta_x), "signed": delta_x, "baseline": float(base_x)})
        if base_y is not None and value_y is not None:
            delta_y = round_trigger(value_y - float(base_y))
            candidates.append({"abs": abs(delta_y), "signed": delta_y, "baseline": float(base_y)})
        if not candidates:
            return none
        strongest = candidates[0]
        for item in candidates[1:]:
            if item["abs"] > strongest["abs"]:
                strongest = item
        return {
            "value": strongest["abs"],
            "signed": strongest["signed"],
            "baseline": strongest["baseline"],
            "basis": "X/Y 双轴分别比较，取绝对值较大方向",
        }

    if metric == "vibration":
        value = number(values.get("accelRms"))
        if value is None:
            return none
        return {
            "value": value,
            "signed": value,
            "baseline": None,
            "basis": "固定统计窗口动态加速度有效值（绝对判定）",
        }

    return none


def level_of(trigger: float, thresholds: dict) -> str:
    if trigger >= thresholds["red"]:
        return "red"
    if trigger >= thresholds["orange"]:
        return "orange"
    if trigger >= thresholds["yellow"]:
        return "yellow"
    return "normal"


SEVERITY = {
    "excluded": -1,
    "unknown": 0,
    "normal": 1,
    "recovering": 2,
    "yellow": 3,
    "orange": 4,
    "red": 5,
}
