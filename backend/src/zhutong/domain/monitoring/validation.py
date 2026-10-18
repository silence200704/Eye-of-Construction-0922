"""监测录入校验：与前端 core/validate.ts 同口径（缺项不按零、重复不覆盖）。"""

from datetime import UTC, datetime

from .catalog import has_numeric_readings, metric_def
from .engine import parse_iso

BACKFILL_THRESHOLD_MINUTES = 30
FUTURE_TOLERANCE_MINUTES = 5

RANGE = {
    "width": {"min": 0, "max": 2000, "label": "裂缝宽度"},
    "angleX": {"min": -180, "max": 180, "label": "X 轴角度"},
    "angleY": {"min": -180, "max": 180, "label": "Y 轴角度"},
    "accelRms": {"min": 0, "max": 200, "label": "加速度有效值"},
    "accelPeak": {"min": 0, "max": 500, "label": "加速度峰值"},
    "temperature": {"min": -50, "max": 120, "label": "温度"},
    "humidity": {"min": 0, "max": 100, "label": "相对湿度"},
}


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def is_future_beyond(at: str, now: str | None = None) -> bool:
    sample = parse_iso(at)
    current = parse_iso(now or now_iso())
    if sample is None or current is None:
        return True
    return (sample - current).total_seconds() > FUTURE_TOLERANCE_MINUTES * 60


def is_backfill(
    sample: str, entered: str, threshold_minutes: int = BACKFILL_THRESHOLD_MINUTES
) -> bool:
    sample_at = parse_iso(sample)
    entered_at = parse_iso(entered)
    if sample_at is None or entered_at is None:
        return False
    return (entered_at - sample_at).total_seconds() > threshold_minutes * 60


def out_of_device_range(values: dict, device: dict | None) -> bool:
    if device is None:
        return False
    low = device.get("rangeMin")
    high = device.get("rangeMax")
    if low is None or high is None:
        return False
    return any(value is not None and (value < low or value > high) for value in values.values())


def _check_values(metric: str, values: dict, issues: list[dict]) -> None:
    if not has_numeric_readings(metric):
        issues.append({"field": "pointId", "message": "人工检查点不产生数值记录，无需录入监测数据"})
        return
    for key, label, _unit, _low, _high in metric_def(metric)["fields"]:
        value = values.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            issues.append({"field": key, "message": f"{label}为必填，缺项不按零处理"})
            continue
        allowed = RANGE[key]
        if value < allowed["min"] or value > allowed["max"]:
            issues.append(
                {
                    "field": key,
                    "message": (
                        f"{allowed['label']}超出可接受区间 {allowed['min']}~{allowed['max']}，"
                        "请核对单位与量程"
                    ),
                }
            )


def _same_minute(first: str, second: str) -> bool:
    left = parse_iso(first)
    right = parse_iso(second)
    if left is None or right is None:
        return False
    return abs((left - right).total_seconds()) < 60


def _check_timing(input: dict, existing: list[dict], issues: list[dict]) -> bool:
    sample_time = input["sampleTime"]
    if parse_iso(sample_time) is None:
        issues.append({"field": "sampleTime", "message": "采样时间格式无效，请重新选择"})
        return False
    if is_future_beyond(sample_time, input.get("enteredAt")):
        issues.append({"field": "sampleTime", "message": "采样时间晚于当前时间，请核对现场时钟"})
        return False
    duplicate = next(
        (
            row
            for row in existing
            if row.get("id") != input.get("excludeRecordId")
            and row.get("pointId") == input.get("pointId")
            and row.get("metric") == input.get("metric")
            and _same_minute(row.get("sampleTime", ""), sample_time)
        ),
        None,
    )
    if duplicate is not None:
        number = duplicate.get("recordNo", "")
        issues.append(
            {
                "field": "sampleTime",
                "message": f"同一点位该分钟已有记录 {number}，请改用修订并保存原值，或调整采样时间",
            }
        )
        return False
    return True


def check_reading(input: dict, existing: list[dict]) -> dict:
    issues: list[dict] = []
    _check_values(input["metric"], input.get("values") or {}, issues)
    if str(input.get("unit", "")).strip() == "":
        issues.append({"field": "unit", "message": "单位必填"})
    time_ok = _check_timing(input, existing, issues)
    if input["metric"] == "vibration" and str(input.get("sampleWindow", "")).strip() == "":
        issues.append(
            {
                "field": "sampleWindow",
                "message": "振动必须填写统计窗口，未提供原始采样不生成真实波形",
            }
        )

    device = input.get("device")
    out_of_range = out_of_device_range(input.get("values") or {}, device)
    needs_note = input.get("quality") == "invalid" or out_of_range
    if needs_note and str(input.get("qualityNote", "")).strip() == "":
        message = (
            f"读数超出设备量程 {(device or {}).get('rangeText', '')}，"
            "将标记为无效并进入数据核查，请填写说明"
            if out_of_range
            else "标记为无效时必须说明原因，否则无法追溯"
        )
        issues.append({"field": "qualityNote", "message": message})

    backfill = time_ok and is_backfill(input["sampleTime"], input.get("enteredAt", ""))
    if backfill and str(input.get("note", "")).strip() == "":
        issues.append(
            {
                "field": "note",
                "message": (
                    "采样时间明显早于录入时间，属历史补录，必须填写补录说明；"
                    "补录数据不得伪装成实时预警"
                ),
            }
        )
    return {"issues": issues, "outOfRange": out_of_range, "backfill": backfill}
