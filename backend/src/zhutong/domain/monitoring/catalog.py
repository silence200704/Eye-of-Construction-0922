"""监测指标字典：字段、单位、合理区间与 CSV 表头，与前端 types/catalog.ts 同口径。"""

METRICS: dict[str, dict] = {
    "crack_width": {
        "name": "裂缝开合",
        "unit": "mm",
        "unit_options": ["mm"],
        "fields": [("width", "裂缝宽度", "mm", 0.0, 2000.0)],
    },
    "tilt_xy": {
        "name": "倾角变化",
        "unit": "°",
        "unit_options": ["°"],
        "fields": [
            ("angleX", "X 轴角度", "°", -180.0, 180.0),
            ("angleY", "Y 轴角度", "°", -180.0, 180.0),
        ],
    },
    "vibration": {
        "name": "楼板振动",
        "unit": "m/s²",
        "unit_options": ["m/s²", "g"],
        "fields": [
            ("accelRms", "加速度有效值", "m/s²", 0.0, 200.0),
            ("accelPeak", "加速度峰值", "m/s²", 0.0, 500.0),
        ],
    },
    "temp_humidity": {
        "name": "温湿度辅助",
        "unit": "℃ / %RH",
        "unit_options": ["℃ / %RH"],
        "fields": [
            ("temperature", "温度", "℃", -50.0, 120.0),
            ("humidity", "相对湿度", "%RH", 0.0, 100.0),
        ],
    },
    "inspection": {"name": "人工检查", "unit": "", "unit_options": [], "fields": []},
}

RULE_METRIC_OF = {
    "crack_width": "crack_width",
    "tilt_xy": "tilt_xy",
    "vibration": "vibration",
    "temp_humidity": "environment",
    "inspection": None,
}

CSV_VALUE_COLUMNS = [
    {"key": field[0], "label": field[1], "unit": field[2]}
    for metric in ("crack_width", "tilt_xy", "vibration", "temp_humidity")
    for field in METRICS[metric]["fields"]
]

CSV_HEADER = [
    "测点编号",
    "采样时间",
    *(column["label"] for column in CSV_VALUE_COLUMNS),
    "单位",
    "统计窗口",
    "质量标记",
    "备注",
]

CSV_QUALITY_TEXT = {"有效": "valid", "存疑": "suspect", "无效": "invalid"}

POINT_TYPES = ("crack", "tilt", "vibration", "temp_humidity", "manual_check")
POINT_METRICS = {
    "crack": "crack_width",
    "tilt": "tilt_xy",
    "vibration": "vibration",
    "temp_humidity": "temp_humidity",
    "manual_check": "inspection",
}


def metric_def(metric: str) -> dict:
    found = METRICS.get(metric)
    if found is None:
        raise ValueError(f"未知指标：{metric}")
    return found


def has_numeric_readings(metric: str) -> bool:
    return len(metric_def(metric)["fields"]) > 0
