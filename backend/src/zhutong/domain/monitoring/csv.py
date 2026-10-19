"""CSV 预检：解析、逐行校验与可导入 payload，与前端 core/csv 同口径。"""

import math
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone

from .catalog import CSV_QUALITY_TEXT, CSV_VALUE_COLUMNS, has_numeric_readings, metric_def
from .engine import parse_iso
from .rules import rule_for_point
from .validation import check_reading

SHANGHAI = timezone(timedelta(hours=8))


def parse_csv(text: str) -> list[list[str]]:
    clean = text.removeprefix("\ufeff")
    rows: list[list[str]] = []
    field = ""
    row: list[str] = []
    in_quotes = False
    index = 0
    while index < len(clean):
        char = clean[index]
        if in_quotes:
            if char == '"':
                if index + 1 < len(clean) and clean[index + 1] == '"':
                    field += '"'
                    index += 1
                else:
                    in_quotes = False
            else:
                field += char
        elif char == '"':
            in_quotes = True
        elif char == ",":
            row.append(field)
            field = ""
        elif char == "\r":
            pass
        elif char == "\n":
            row.append(field)
            rows.append(row)
            row = []
            field = ""
        else:
            field += char
        index += 1
    row.append(field)
    rows.append(row)
    return [cells for cells in rows if any(cell.strip() != "" for cell in cells)]


def read_table(text: str) -> dict:
    rows = parse_csv(text)
    if not rows:
        return {"header": [], "data": []}
    header = [cell.strip() for cell in rows[0]]
    data = [{"lineNo": index + 2, "cells": cells} for index, cells in enumerate(rows[1:])]
    return {"header": header, "data": data}


def column_index(header: list[str], name: str) -> int:
    try:
        return header.index(name)
    except ValueError:
        return -1


def cell_of(cells: list[str], index: int) -> str:
    if index < 0 or index >= len(cells):
        return ""
    return (cells[index] or "").strip()


def parse_sample_time(text: str) -> str:
    if text == "":
        return ""
    normalized = text if "T" in text else text.replace(" ", "T")
    try:
        parsed = datetime.fromisoformat(
            normalized[:-1] + "+00:00" if normalized.endswith("Z") else normalized
        )
    except ValueError:
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=SHANGHAI)
    return parsed.astimezone(UTC).isoformat()


def _read_values(point: dict, cells: list[str], header: list[str]) -> dict:
    values: dict = {}
    for key, _label, _unit, _low, _high in metric_def(point["metric"])["fields"]:
        column = next((item for item in CSV_VALUE_COLUMNS if item["key"] == key), None)
        if column is None:
            continue
        raw = cell_of(cells, column_index(header, column["label"]))
        if raw == "":
            continue
        try:
            parsed = float(raw)
        except ValueError:
            continue
        if math.isfinite(parsed):
            values[key] = parsed
    return values


def _stray_columns(point: dict, cells: list[str], header: list[str]) -> list[str]:
    used = {field[0] for field in metric_def(point["metric"])["fields"]}
    return [
        column["label"]
        for column in CSV_VALUE_COLUMNS
        if column["key"] not in used and cell_of(cells, column_index(header, column["label"])) != ""
    ]


def _read_identity(header: list[str], cells: list[str], context: dict, seen: set[str]) -> dict:
    code = cell_of(cells, column_index(header, "测点编号"))
    point = next((row for row in context["points"] if row.get("code") == code), None)
    if point is None:
        return {"ok": False, "message": f"测点编号 {code} 在档案中不存在"}
    if not has_numeric_readings(point.get("metric", "")):
        return {"ok": False, "message": "该点位是人工检查点，不接受数值导入"}
    time_text = cell_of(cells, column_index(header, "采样时间"))
    sample_time = parse_sample_time(time_text)
    if sample_time == "":
        return {"ok": False, "message": f"采样时间「{time_text}」无法解析"}
    minute_key = f"{point['id']}#{sample_time[:16]}"
    if minute_key in seen:
        return {"ok": False, "message": "同一份文件里该测点该分钟重复出现，保留第一条即可"}
    seen.add(minute_key)
    return {"ok": True, "point": point, "sampleTime": sample_time}


def _read_details(point: dict, cells: list[str], header: list[str]) -> dict:
    messages: list[str] = []
    definition = metric_def(point["metric"])
    unit_text = cell_of(cells, column_index(header, "单位"))
    unit = definition["unit"] if unit_text == "" else unit_text
    if unit_text == "":
        messages.append(f"单位留空，按指标默认单位 {definition['unit']} 处理")
    elif unit_text not in definition["unit_options"]:
        options = " 或 ".join(definition["unit_options"])
        return {"fatal": f"单位「{unit_text}」不属于该指标，应为 {options}", "messages": messages}
    stray = _stray_columns(point, cells, header)
    if stray:
        messages.append(f"该测点用不到这些列，已忽略：{'、'.join(stray)}")
    quality_text = cell_of(cells, column_index(header, "质量标记")) or "有效"
    raw_note = cell_of(cells, column_index(header, "备注"))
    return {
        "fatal": None,
        "messages": messages,
        "values": _read_values(point, cells, header),
        "unit": unit,
        "sampleWindow": cell_of(cells, column_index(header, "统计窗口")),
        "quality": CSV_QUALITY_TEXT.get(quality_text, "valid"),
        "note": "CSV 批量导入" if raw_note == "" else f"{raw_note}（CSV 批量导入）",
    }


def _row_summary(cells: list[str], header: list[str]) -> str:
    code = cell_of(cells, column_index(header, "测点编号"))
    time = cell_of(cells, column_index(header, "采样时间"))
    return f"{code or '（缺测点）'}｜{time or '（缺时间）'}"


@dataclass(frozen=True)
class PreviewRow:
    line_no: int
    cells: list[str]
    header: list[str]
    header_ok: bool
    context: dict
    seen: set[str]


def _row_error(line_no: int, summary: str, message: str) -> dict:
    return {
        "lineNo": line_no,
        "status": "error",
        "payload": None,
        "summary": summary,
        "messages": [message],
    }


def _checked_row(
    row: PreviewRow, point: dict, details: dict, check: dict, messages: list[str]
) -> dict:
    blocked = len(check["issues"]) > 0
    payload = None
    if not blocked:
        payload = {
            "pointId": point["id"],
            "pointLabel": f"{point['code']} {point['name']}",
            "sampleTime": row.context["sampleTime"],
            "values": details["values"],
            "unit": details["unit"],
            "sampleWindow": details["sampleWindow"],
            "quality": "invalid" if check["outOfRange"] else details["quality"],
            "note": details["note"],
        }
    return {
        "lineNo": row.line_no,
        "status": "error" if blocked else ("warn" if messages else "ok"),
        "payload": payload,
        "summary": _row_summary(row.cells, row.header),
        "messages": messages,
    }


def _preview_row(row: PreviewRow) -> dict:
    summary = _row_summary(row.cells, row.header)
    if not row.header_ok:
        return _row_error(row.line_no, summary, "表头缺少必需列")
    identity = _read_identity(row.header, row.cells, row.context, row.seen)
    if not identity["ok"]:
        return _row_error(row.line_no, summary, identity["message"])
    point = identity["point"]
    details = _read_details(point, row.cells, row.header)
    if details["fatal"] is not None:
        return _row_error(row.line_no, summary, details["fatal"])
    check = check_reading(
        {
            "pointId": point["id"],
            "metric": point["metric"],
            "values": details["values"],
            "unit": details["unit"],
            "sampleTime": identity["sampleTime"],
            "sampleWindow": details["sampleWindow"],
            "quality": details["quality"],
            "qualityNote": details["note"],
            "note": details["note"],
            "excludeRecordId": None,
            "device": None,
            "enteredAt": row.context.get("enteredAt"),
        },
        row.context["existing"],
    )
    messages = [*details["messages"], *(issue["message"] for issue in check["issues"])]
    if check["backfill"]:
        messages.append("采样时间早于当前时间，将标记为历史补录")
    if check["outOfRange"]:
        messages.append("超出设备量程，将标记为无效并进入数据核查")
    if rule_for_point(row.context["rules"], point, identity["sampleTime"]) is None:
        messages.append("该采样时间没有适用规则，本行只存档不判定")
    return _checked_row(
        PreviewRow(
            line_no=row.line_no,
            cells=row.cells,
            header=row.header,
            header_ok=row.header_ok,
            context={**row.context, "sampleTime": identity["sampleTime"]},
            seen=row.seen,
        ),
        point,
        details,
        check,
        messages,
    )


def build_preview(text: str, context: dict) -> dict:
    table = read_table(text)
    header = table["header"]
    missing = [name for name in ("测点编号", "采样时间") if column_index(header, name) == -1]
    header_ok = not missing
    seen: set[str] = set()
    rows = [
        _preview_row(
            PreviewRow(
                line_no=item["lineNo"],
                cells=item["cells"],
                header=header,
                header_ok=header_ok,
                context=context,
                seen=seen,
            )
        )
        for item in table["data"]
    ]
    return {
        "headerOk": header_ok,
        "headerMissing": missing,
        "rows": rows,
        "okCount": sum(1 for row in rows if row["status"] == "ok"),
        "warnCount": sum(1 for row in rows if row["status"] == "warn"),
        "errorCount": sum(1 for row in rows if row["status"] == "error"),
    }


def valid_payloads(preview: dict) -> list[dict]:
    return [row["payload"] for row in preview["rows"] if row["payload"] is not None]


def stale_marker(context: dict) -> dict:
    """预览与确认之间要重读的对象状态；任一变化都要求重新预览。"""
    points = sorted(
        (row["id"], row.get("revision", 0), row.get("status", "active"))
        for row in context["points"]
    )
    rules = sorted(
        (row["id"], row.get("revision", 0), row.get("effectiveFrom", ""))
        for row in context["rules"]
    )
    baselines = sorted(
        (row["id"], row.get("version", 0), row.get("effectiveFrom", ""), row.get("current", False))
        for row in context["baselines"]
    )
    records = sorted((row["id"], row.get("recordRevision", 0)) for row in context["existing"])
    return {"points": points, "rules": rules, "baselines": baselines, "records": records}


def parse_iso_safe(value: str) -> bool:
    return parse_iso(value) is not None
