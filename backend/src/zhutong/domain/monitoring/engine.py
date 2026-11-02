"""监测判定引擎：与前端 core/assess/engine.ts 逐条同口径。

输入统一为 camelCase 字典（规则版本行、测点、记录都由序列化层产出），
因此同一份样例可以同时驱动 TypeScript 旧引擎和 Python 新引擎。
"""

from datetime import datetime
from typing import Any

from .catalog import has_numeric_readings
from .trigger import SEVERITY, level_of, number, trigger_of

STATE_LABEL = {
    "unknown": "数据不足",
    "normal": "未越限",
    "yellow": "黄色关注",
    "orange": "橙色排查",
    "red": "红色紧急核查",
    "recovering": "恢复待确认",
    "excluded": "不参与判定",
}


def parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or value == "":
        return None
    text = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def minutes_between(first: str, second: str) -> float:
    start = parse_iso(first)
    end = parse_iso(second)
    if start is None or end is None:
        return 0.0
    return (end - start).total_seconds() / 60


def out_of_device_range(values: dict, device: dict | None) -> bool:
    if device is None:
        return False
    low = number(device.get("rangeMin"))
    high = number(device.get("rangeMax"))
    if low is None or high is None:
        return False
    return any(
        value is not None and (value < low or value > high)
        for value in map(number, values.values())
    )


def base_assessment(rule: dict) -> dict:
    return {
        "state": "excluded",
        "triggerValue": None,
        "baselineValue": None,
        "ruleCode": rule.get("code", ""),
        "ruleVersion": rule.get("version", ""),
        "reason": "",
        "insufficientReason": "",
        "basis": "",
    }


def _has_metric_value(rule: dict, values: dict) -> bool:
    metric = rule.get("metric")
    if metric == "crack_width":
        return number(values.get("width")) is not None
    if metric == "tilt_xy":
        return number(values.get("angleX")) is not None or number(values.get("angleY")) is not None
    if metric == "vibration":
        return number(values.get("accelRms")) is not None
    return True


def rate_of(rule: dict, history: list[dict], current: dict, at: str) -> float | None:
    moment = parse_iso(at)
    previous = None
    for row in reversed(history):
        sample = parse_iso(row.get("sampleTime", ""))
        if moment is None or sample is None or sample >= moment:
            continue
        probe = trigger_of(rule, row.get("values") or {}, row.get("baselineValues"))
        if probe["signed"] is not None:
            previous = row
            break
    if previous is None or current["signed"] is None:
        return None
    hours = minutes_between(previous.get("sampleTime", ""), at) / 60
    if hours <= 0:
        return None
    before = trigger_of(rule, previous.get("values") or {}, previous.get("baselineValues"))[
        "signed"
    ]
    if before is None:
        return None
    return round(((current["signed"] - before) / hours) * 1e6) / 1e6


def persistence_of(rule: dict, history: list[dict]) -> str:
    thresholds = rule.get("thresholds")
    if thresholds is None:
        return "insufficient"
    run: list[dict] = []
    for row in reversed(history):
        value = trigger_of(rule, row.get("values") or {}, row.get("baselineValues"))["value"]
        if value is None or value < thresholds["yellow"]:
            break
        run.insert(0, row)
    persistence = rule.get("persistence") or {}
    if len(run) < persistence.get("minRecords", 0):
        return "insufficient"
    first, last = run[0], run[-1]
    if minutes_between(first.get("sampleTime", ""), last.get("sampleTime", "")) < persistence.get(
        "minSpanMinutes", 0
    ):
        return "insufficient"
    for index in range(1, len(run)):
        gap = minutes_between(
            run[index - 1].get("sampleTime", ""), run[index].get("sampleTime", "")
        )
        if gap > persistence.get("maxGapMinutes", 0):
            return "miss"
    return "hit"


def recovery_of(rule: dict, history: list[dict]) -> str:
    thresholds = rule.get("thresholds")
    if thresholds is None:
        return "insufficient"
    recovery = rule.get("recovery") or {}
    limit = thresholds["yellow"] * recovery.get("yellowRatio", 0)
    need = recovery.get("minRecords", 0)
    if need <= 0:
        return "insufficient"
    tail = history[-need:]
    if len(tail) < need:
        return "insufficient"
    for row in tail:
        value = trigger_of(rule, row.get("values") or {}, row.get("baselineValues"))["value"]
        if value is None or value >= limit:
            return "miss"
    if recovery.get("minSpanMinutes", 0) > 0:
        span = minutes_between(tail[0].get("sampleTime", ""), tail[-1].get("sampleTime", ""))
        if span < recovery["minSpanMinutes"]:
            return "insufficient"
    return "recovering"


def _in_environment_range(value: float | None, low: float | None, high: float | None) -> bool:
    if value is None:
        return False
    return (low is not None and value < low) or (high is not None and value > high)


def assess_environment(input: dict) -> dict:
    rule = input["rule"]
    condition = rule.get("environment")
    base = {
        "state": "unknown",
        "triggerValue": None,
        "baselineValue": None,
        "ruleCode": rule.get("code", ""),
        "ruleVersion": rule.get("version", ""),
        "reason": "",
        "insufficientReason": "",
        "basis": "环境辅助数据",
    }
    if condition is None:
        return {**base, "insufficientReason": "规则未配置环境条件"}
    values = input["values"]
    temperature = number(values.get("temperature"))
    humidity = number(values.get("humidity"))
    if temperature is None and humidity is None:
        return {**base, "insufficientReason": "缺少温度或湿度读数"}
    hit = _in_environment_range(
        temperature, condition.get("tempMin"), condition.get("tempMax")
    ) or _in_environment_range(humidity, None, condition.get("humidityMax"))
    if not hit:
        return {
            **base,
            "state": "normal",
            "triggerValue": temperature if temperature is not None else None,
            "reason": "温度与相对湿度均在环境提醒范围之外",
        }
    records = condition.get("persistenceRecords", 0)
    consecutive = input["history"][-records:] if records > 0 else []
    all_hit = len(consecutive) == records and all(
        _in_environment_range(
            number(row.get("values", {}).get("temperature")),
            condition.get("tempMin"),
            condition.get("tempMax"),
        )
        or _in_environment_range(
            number(row.get("values", {}).get("humidity")), None, condition.get("humidityMax")
        )
        for row in consecutive
    )
    temperature_text = "—" if temperature is None else _plain(temperature)
    humidity_text = "—" if humidity is None else _plain(humidity)
    return {
        **base,
        "state": "orange" if all_hit else "yellow",
        "triggerValue": temperature if temperature is not None else humidity,
        "reason": (
            f"连续 {records} 条环境读数越限，生成环境复核任务；不单独作为结构危险结论"
            if all_hit
            else (
                f"温度 {temperature_text}℃ / 湿度 {humidity_text}%RH 超出环境提醒范围，"
                "不单独作为结构危险结论"
            )
        ),
        "basis": "环境提醒",
    }


def _plain(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value)


def assess_structure(input: dict, base: dict) -> dict:
    rule = input["rule"]
    thresholds = rule.get("thresholds")
    if thresholds is None:
        return {**base, "state": "unknown", "insufficientReason": "规则未配置阈值"}
    trigger = trigger_of(rule, input["values"], input.get("baselineValues"))
    if trigger["value"] is None:
        missing = (
            "缺少判定读数"
            if not _has_metric_value(rule, input["values"])
            else "该测点尚未设置有效基准，无法计算变化量"
        )
        return {**base, "state": "unknown", "insufficientReason": missing}

    state = level_of(trigger["value"], thresholds)
    basis = trigger["basis"]
    insufficient = ""
    reason = (
        ""
        if state == "normal"
        else f"判定值 {trigger['value']:.2f} {rule.get('unit', '')} 达到{STATE_LABEL[state]}门槛"
    )

    rate_threshold = number(rule.get("rateThreshold"))
    if rate_threshold is not None and state != "red":
        rate = rate_of(rule, input["history"], trigger, input["at"])
        if rate is None:
            insufficient = "历史记录不足两条或时间差为零，可判断绝对值，不能判断变化速率"
        elif (
            rate >= rate_threshold
            and SEVERITY.get(rule.get("rateLevel", "orange"), 0) > SEVERITY[state]
        ):
            state = rule.get("rateLevel", "orange")
            basis = f"变化速率 {rate:.2f} {rule.get('unit', '')}/h ≥ {rate_threshold}"
            reason = f"变化速率达到{STATE_LABEL[state]}门槛"

    persistence = persistence_of(rule, input["history"])
    if persistence == "insufficient":
        insufficient = insufficient or "数据不足，无法判断持续趋势"
    elif (
        persistence == "hit"
        and SEVERITY.get((rule.get("persistence") or {}).get("level"), 0) > SEVERITY[state]
    ):
        state = (rule.get("persistence") or {}).get("level", "orange")
        persistence_rule = rule.get("persistence") or {}
        basis = (
            f"持续异常：{persistence_rule.get('minRecords')} 条有效记录均越限且覆盖不少于 "
            f"{persistence_rule.get('minSpanMinutes')} 分钟"
        )
        reason = "满足持续异常条件"

    if state == "normal":
        recovery = recovery_of(rule, input["history"])
        if recovery == "recovering":
            state = "recovering"
            recovery_rule = rule.get("recovery") or {}
            basis = (
                f"连续 {recovery_rule.get('minRecords')} 条低于黄色阈值的 "
                f"{round(recovery_rule.get('yellowRatio', 0) * 100)}%"
            )
            reason = "恢复待确认：只改变数据状态，不自动关闭问题"
        elif recovery == "insufficient":
            insufficient = insufficient or "记录条数不足，无法判断恢复趋势"

    return {
        **base,
        "state": state,
        "triggerValue": trigger["value"],
        "baselineValue": trigger["baseline"],
        "reason": reason,
        "insufficientReason": insufficient,
        "basis": basis,
    }


def assess_record(input: dict) -> dict:
    """判定一条记录：质量/量程/规则状态分流后，再交给结构或环境判定。"""
    rule = input["rule"]
    point = input["point"]
    base = base_assessment(rule)
    if not has_numeric_readings(point.get("metric", "")):
        return {**base, "reason": "人工检查点不产生数值记录，不参与判定"}
    quality = input.get("quality", "valid")
    if quality != "valid":
        reason = (
            "质量标记为无效：保存留痕，不参与判定"
            if quality == "invalid"
            else "质量标记为存疑：待复核，不参与判定"
        )
        return {**base, "reason": reason}
    if out_of_device_range(input.get("values") or {}, input.get("device")):
        return {**base, "reason": "超出设备量程：标记为无效并进入数据核查，不触发结构预警"}
    if not rule.get("enabled", True):
        return {**base, "reason": "规则未启用"}
    at = parse_iso(input.get("at"))
    effective = parse_iso(rule.get("effectiveFrom"))
    if at is not None and effective is not None and effective > at:
        return {**base, "reason": "规则尚未生效，不参与当前数据判断"}

    history = [row for row in input.get("history", []) if row.get("quality", "valid") == "valid"]
    valid_input = {**input, "history": history}
    if rule.get("metric") == "environment":
        return assess_environment(valid_input)
    return assess_structure(valid_input, base)
