"""问句的确定性解析：归一化 → 意图分类 → 实体抽取。

与前端 src/assistant/parse.ts 同一套词表与优先级，预设问法与自由输入共用这一条路径。
纯函数：不读库、不看当前时间；对象是否存在由 resolve 复核，这里不猜。
"""

import re

METRIC_WORDS = [
    (["裂缝", "开合"], "crack_width"),
    (["倾角", "倾斜"], "tilt_xy"),
    (["振动", "震动", "加速度", "楼板"], "vibration"),
    (["温湿度", "温度", "湿度"], "temp_humidity"),
    (["人工检查", "人工巡检"], "inspection"),
]
WHY_WORDS = ["为什么", "为何", "原因", "怎么会", "咋回事", "怎么触发", "凭什么"]
UNHANDLED_WORDS = ["待处理", "未处理", "没处理", "还没处理", "待办", "未关闭", "没关闭", "未处置"]
ALARM_WORDS = ["预警", "告警", "报警", "事件"]
CAMPUS_WORDS = ["全校", "校区", "校园", "整体", "总体", "全局", "所有楼栋", "全部楼栋"]
OVERVIEW_WORDS = ["概况", "总览", "汇总", "监测情况", "整体情况", "总体情况"]
POINT_WORDS = ["测点", "点位", "传感器", "设备", "探头", "监测点"]
MEDIA_WORDS = ["照片", "图片", "影像", "摄像头", "视频", "短片", "拍照"]
GUIDE_WORDS = [
    "带我演示",
    "带我看处理流程",
    "演示处理流程",
    "演示处置流程",
    "下一步怎么办",
    "处理到哪",
    "处置进度",
    "维修进度",
    "工单进度",
    "办理到哪",
    "还缺什么",
    "打开完整处置报告",
]
FOLLOW_UP_WORDS = [
    "它",
    "他",
    "这条",
    "那条",
    "该测点",
    "该点位",
    "该设备",
    "这个",
    "刚才那个",
    "上面那个",
]
RECOVERY_WORDS = ["恢复", "回落", "降下来", "回到正常", "回到安全"]
REPLAY_WORDS = ["回放", "重放", "从头再看", "时间线"]
CASE_WORDS = ["案例", "类似", "历史问题", "以前怎么处理", "之前怎么处理", "参考"]
SIMULATE_WORDS = ["试算", "如果阈值", "假如阈值", "改成"]
ISSUE_WORDS = ["问题", "工单", "维修", "复查"]
COMPARE_WORDS = ["比较", "对比", "一起看", "同范围"]
TREND_WORDS = ["趋势", "曲线", "走势", "变化过程"]
STRONG_KNOWLEDGE_WORDS = [
    "会自动",
    "能不能",
    "可以吗",
    "是否需要",
    "怎么判定",
    "需要哪些",
    "可以自行",
    "能自行",
    "能删除吗",
    "有哪些来源",
    "有哪几种",
    "六种",
    "几张",
    "多大",
    "怎么转",
    "计入",
    "处理出口",
    "最终闭环率",
]
WRITE_WORDS = ["准备", "载入", "生成", "造一条", "来一条", "写入", "模拟"]
DEMO_WORDS = ["演示", "红色", "预警", "数据"]
KNOWLEDGE_WORDS = [
    "规定",
    "规范",
    "要求",
    "标准",
    "依据",
    "是什么意思",
    "怎么判定",
    "流程",
    "口径",
    "阈值怎么定",
    "允许",
    "可以吗",
    "能自行",
    "能不能",
    "需要吗",
    "是否需要",
    "会自动",
    "要不要",
]
FULL_WIDTH = re.compile(r"[\uFF01-\uFF5E]")
PUNCT = re.compile(r"[\s，。、；：？！“”‘’〈〉《》【】（）()[\]]")
POINT_CODE = re.compile(r"[a-z]{1,4}\d{1,4}(?:-[a-z0-9]+)+", re.IGNORECASE)
EVENT_NO = re.compile(r"e-?\d{8}-\d{3}", re.IGNORECASE)
ISSUE_NO = re.compile(r"iss-?\d{8}-\d{3}", re.IGNORECASE)
ORDER_NO = re.compile(r"wo-?\d{8}-\d{3}", re.IGNORECASE)
BUILDING_CODE = re.compile(r"(?:^|[^A-Za-z0-9-])b\d{2}(?![0-9])", re.IGNORECASE)
BUILDING_NAME = re.compile(r"\d{1,2}号[^0-9]{0,4}")
FLOOR = re.compile(r"(\d{1,2})层|f(\d{1,2})\b", re.IGNORECASE)


def normalize(raw: str) -> dict:
    half = FULL_WIDTH.sub(lambda ch: chr(ord(ch.group(0)) - 0xFEE0), raw)
    dashed = PUNCT.sub("", half)
    return {"dashed": dashed, "compact": dashed.lower().replace("-", "")}


def _has(words: list[str], text: str) -> bool:
    return any(word in text for word in words)


def _match(pattern: re.Pattern, text: str) -> str | None:
    found = pattern.search(text)
    return found.group(0) if found else None


def has_point_clue(entities: dict) -> bool:
    return (
        entities["pointCode"] is not None
        or entities["buildingRefs"]
        or entities["metric"] is not None
        or entities["floorNumber"] is not None
    )


def extract_entities(q: dict) -> dict:
    dashed, compact = q["dashed"], q["compact"]
    event_no = _match(EVENT_NO, dashed)
    issue_no = _match(ISSUE_NO, dashed)
    order_no = _match(ORDER_NO, dashed)
    point_code = _match(POINT_CODE, dashed)
    if point_code is not None:
        numbers = {value.lower() for value in (event_no, issue_no, order_no) if value is not None}
        if point_code.lower() in numbers:
            point_code = None
    building_refs: list[str] = []
    if point_code is not None:
        building_refs.append(point_code.split("-")[0])
    for found in BUILDING_CODE.finditer(dashed):
        token = re.sub(r"[^A-Za-z0-9]", "", found.group(0))
        if token and token not in building_refs:
            building_refs.append(token)
    for found in BUILDING_NAME.finditer(compact):
        if found.group(0) not in building_refs:
            building_refs.append(found.group(0))
    floor = _match(FLOOR, dashed)
    floor_number = None
    if floor is not None:
        digits = re.search(r"\d{1,2}", floor)
        floor_number = int(digits.group(0)) if digits else None
    metric = None
    for words, key in METRIC_WORDS:
        if _has(words, compact):
            metric = key
            break
    return {
        "pointCode": point_code.lower() if point_code else None,
        "eventNo": event_no.upper() if event_no else None,
        "issueNo": issue_no.upper() if issue_no else None,
        "orderNo": order_no.upper() if order_no else None,
        "buildingRefs": building_refs,
        "floorNumber": floor_number,
        "metric": metric,
    }


def _wants_recovery(compact: str) -> bool:
    return (
        _has(RECOVERY_WORDS, compact)
        and not _has(MEDIA_WORDS, compact)
        and not _has(WHY_WORDS, compact)
    )


def _wants_spatial(compact: str) -> bool:
    spatial = any(w in compact for w in ("3d", "三维", "空间模型", "楼层模型"))
    go = any(
        w in compact for w in ("带我到", "带我去", "带我", "看位置", "在哪", "定位", "看看位置")
    )
    return (spatial and go) or bool(re.search(r"它在哪|帮我定位|定位(?:这个|该|b\d)", compact))


def _command_intent(compact: str, entities: dict) -> str | None:
    if _has(WRITE_WORDS, compact) and _has(DEMO_WORDS, compact):
        return "demo_command"
    if _has(SIMULATE_WORDS, compact) or "试算" in compact:
        return "rule_simulate"
    if _has(REPLAY_WORDS, compact) or "回放" in compact:
        return "event_replay"
    if _has(CASE_WORDS, compact) and not _has(KNOWLEDGE_WORDS, compact):
        return "case_search"
    if _has(COMPARE_WORDS, compact) and (
        entities["metric"] is not None or len(entities["buildingRefs"]) >= 1
    ):
        return "point_compare"
    if entities["orderNo"] is not None or entities["issueNo"] is not None:
        return "issue_status"
    if _has(GUIDE_WORDS, compact) or "怎么办理" in compact or "如何办理" in compact:
        return "demo_guide" if _has(GUIDE_WORDS, compact) else "knowledge"
    strong = _has(STRONG_KNOWLEDGE_WORDS, compact)
    if (
        (strong or _has(KNOWLEDGE_WORDS, compact))
        and not has_point_clue(entities)
        and (strong or not _has(ALARM_WORDS, compact))
    ):
        return "knowledge"
    if _wants_recovery(compact):
        return "reading_recovery"
    if _has(TREND_WORDS, compact):
        return "point_trend"
    if _wants_spatial(compact):
        return "spatial_go"
    return None


def _media_intent(compact: str, entities: dict) -> str | None:
    if _has(CAMPUS_WORDS, compact) or (
        not has_point_clue(entities)
        and not _has(POINT_WORDS, compact)
        and _has(OVERVIEW_WORDS, compact)
    ):
        return "campus_overview"
    if re.search(r"视频|关键帧|短片", compact):
        return "video_compare"
    if _has(MEDIA_WORDS, compact):
        return "media_compare"
    return None


def _object_intent(compact: str, entities: dict) -> str:
    if entities["orderNo"] is not None or (
        _has(ISSUE_WORDS, compact)
        and not _has(ALARM_WORDS, compact)
        and not has_point_clue(entities)
        and _has(["可以", "能否", "能不能", "需要", "应该", "流程", "材料", "依据"], compact)
    ):
        return "knowledge"
    if _has(WHY_WORDS, compact) and (
        entities["eventNo"] is not None
        or has_point_clue(entities)
        or _has(ALARM_WORDS, compact)
        or _has(FOLLOW_UP_WORDS, compact)
    ):
        return "event_reason"
    if entities["eventNo"] is not None:
        return "event_reason"
    if entities["orderNo"] is not None or (
        _has(ISSUE_WORDS, compact) and not _has(ALARM_WORDS, compact)
    ):
        return "issue_status"
    if (
        not has_point_clue(entities)
        and re.search(r"哪个|哪些|列出|所有", compact)
        and "异常" in compact
        and _has(POINT_WORDS, compact)
    ):
        return "open_events"
    if _has(UNHANDLED_WORDS, compact) and _has(ALARM_WORDS, compact):
        return "open_events"
    if _has(POINT_WORDS, compact) or has_point_clue(entities) or entities["eventNo"]:
        return "point_status"
    if _has(FOLLOW_UP_WORDS, compact):
        return "point_status"
    return "unknown"


def parse_intent(q: dict, entities: dict) -> str:
    compact = q["compact"]
    command = _command_intent(compact, entities)
    if command is not None:
        return command
    media = _media_intent(compact, entities)
    if media is not None:
        return media
    return _object_intent(compact, entities)
