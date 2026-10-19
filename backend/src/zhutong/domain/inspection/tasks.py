"""巡检任务到点与逐点完成判定，与前端 core/inspection/checkIn.ts 同口径。"""


def initial_results(snapshot: dict) -> list[dict]:
    checklist = snapshot.get("checklist") or []
    return [
        {
            "pointId": point_id,
            "status": "pending",
            "checkedAt": None,
            "method": None,
            "labelRead": "",
            "labelExpected": "",
            "labelVersion": None,
            "fallbackReason": "",
            "attempts": [],
            "checklist": [
                {
                    "key": item.get("key", ""),
                    "label": item.get("label", ""),
                    "result": None,
                    "note": "",
                }
                for item in checklist
            ],
            "abnormalHandling": {"linkedIssueId": None, "reason": ""},
            "issueIds": [],
        }
        for point_id in snapshot.get("pointIds") or []
    ]


def task_status(results: list[dict]) -> str:
    if not results:
        return "pending"
    completed = sum(1 for row in results if row.get("status") == "completed")
    if completed == 0:
        return "pending"
    return "checked" if completed == len(results) else "partial"


def check_in(input: dict) -> dict:
    result = input["result"]
    point = input["point"]
    method = input["method"]
    label_read = input["label_read"]
    fallback_reason = input["fallback_reason"]
    at = input["at"]
    read = label_read.strip()
    nfc = point.get("nfc") or {}
    expected = str(nfc.get("code") or "")
    version = nfc.get("version")
    if read == "":
        passed, message = False, "未提供标签编号，点位仍为待到点"
    elif expected == "":
        passed, message = (
            False,
            "该点位未登记 NFC 标签，无法核对编号；请先在档案里登记标签，或走人工兜底并说明原因",
        )
    elif read != expected:
        passed, message = (
            False,
            f"标签编号不一致：读到 {read}，该点位登记为 {expected}。错点不计入到点，已留痕",
        )
    elif method == "manual" and fallback_reason.strip() == "":
        passed, message = False, "人工兜底签到必须填写原因（例如读卡失败、标签损坏），否则不予到点"
    else:
        via = "模拟读卡" if method == "nfc" else "人工兜底"
        passed, message = True, f"{via}核对通过（标签 {expected} v{version or 1}）"
    attempt = {
        "at": at,
        "method": method,
        "labelRead": read,
        "labelExpected": expected,
        "labelVersion": version if passed else None,
        "fallbackReason": fallback_reason.strip(),
        "passed": passed,
        "message": message,
    }
    next_row = {**result, "attempts": [*(result.get("attempts") or []), attempt]}
    if not passed:
        return next_row
    return {
        **next_row,
        "status": "completed" if result.get("status") == "completed" else "arrived",
        "checkedAt": result.get("checkedAt") or at,
        "method": method,
        "labelRead": read,
        "labelExpected": expected,
        "labelVersion": version,
        "fallbackReason": fallback_reason.strip(),
    }


def complete_check(input: dict) -> dict:
    result = input["result"]
    if result.get("status") == "pending":
        raise ValueError("尚未到点，不能提交检查完成；请先模拟读卡或走人工兜底签到")
    if result.get("status") == "completed":
        raise ValueError("该点位的检查已完成，如需更正请走记录修订")
    answers = input["answers"]
    answered = {row.get("key"): row for row in answers}
    missing = [key for key in input["required_keys"] if answered.get(key, {}).get("result") is None]
    if missing:
        raise ValueError(f"还有 {len(missing)} 个必答检查项没有作答，不能提交为检查完成")
    abnormal = [row for row in answers if row.get("result") == "abnormal"]
    valid_issue = input.get("issue_valid", False)
    reason = str(input.get("reason", "")).strip()
    if abnormal and not valid_issue and len(reason) < 10:
        raise ValueError(
            "检查项出现异常：请创建巡检问题并关联到本点位，"
            "或写明“无需建问题”的依据（不少于 10 个字）"
        )
    return {
        **result,
        "status": "completed",
        "checklist": [{**row} for row in answers],
        "abnormalHandling": {
            "linkedIssueId": input.get("linked_issue_id") if valid_issue else None,
            "reason": reason,
        },
    }
