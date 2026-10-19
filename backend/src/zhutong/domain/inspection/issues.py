"""问题审核出口、关联与复查规则，与前端 core/inspection 同口径。"""

from .schedule import valid_day

REVIEW_NOTE_MIN_LENGTH = 4
NO_FAULT_MIN_LENGTH = 10
RECHECK_MIN_LENGTH = 4

REVIEW_FLOW = {
    "to_repair": "repairing",
    "to_investigate": "investigating",
    "need_evidence": "pending_review",
    "link_object": "closed",
    "recheck": "pending_recheck",
    "close_no_fault": "closed",
}

CATEGORIES = {
    "to_repair": {"equipment", "general"},
    "to_investigate": {"crack", "tilt", "structure"},
    "recheck": {"unclear", "remeasure"},
    "need_evidence": {"image", "location", "description", "measurement"},
    "link_object": {"issue", "event"},
    "close_no_fault": {"no_fault", "false_alarm", "reading_stable", "non_structural", "handled"},
}

OPEN_RECHECK = {"pending_recheck", "observing"}


def review_action(input: dict) -> str:
    action = input.get("action")
    categories = CATEGORIES.get(action)
    if categories is None:
        raise ValueError("未知的审核出口")
    if input.get("category") not in categories:
        raise ValueError("请选择该出口下的处理结果（二级分类）")
    if input.get("status") == "closed":
        raise ValueError("该问题已关闭，如需继续处理请新建问题并关联原记录")
    note = str(input.get("note", "")).strip()
    if len(note) < REVIEW_NOTE_MIN_LENGTH:
        raise ValueError(
            f"审核意见不少于 {REVIEW_NOTE_MIN_LENGTH} 个字，否则事后无法解释当时的判断"
        )
    if action == "need_evidence" and len(note) < NO_FAULT_MIN_LENGTH:
        raise ValueError(f"退回补充要写明还缺什么（不少于 {NO_FAULT_MIN_LENGTH} 个字）")
    if action == "link_object":
        if input.get("category") == "issue" and not str(input.get("duplicate_of") or "").strip():
            raise ValueError("关联已有问题必须选择要关联的原记录")
        if input.get("category") == "event" and not str(input.get("linked_event_id") or "").strip():
            raise ValueError("关联既有预警事件必须选择要关联的事件")
        if input.get("duplicate_of") == input.get("issue_id"):
            raise ValueError("不能把问题关联到它自己")
    if action == "close_no_fault" and len(note) < NO_FAULT_MIN_LENGTH:
        raise ValueError(f"关闭必须写明依据（不少于 {NO_FAULT_MIN_LENGTH} 个字）")
    if action == "to_investigate" and len(note) < NO_FAULT_MIN_LENGTH:
        raise ValueError("转专业排查必须写明排查方向（不少于 10 个字）")
    if (
        action == "close_no_fault"
        and input.get("category") == "handled"
        and int(input.get("photo_count", 0)) == 0
        and len(str(input.get("no_photo_reason", "")).strip()) < NO_FAULT_MIN_LENGTH
    ):
        raise ValueError("“已当场处理”需要现场照片，或写明无法拍照的原因（不少于 10 个字）")
    return REVIEW_FLOW[action]


def active_round(issue: dict) -> dict | None:
    rounds = issue.get("rechecks") or []
    if not rounds:
        return None
    last = rounds[-1]
    return last if last.get("outcome") is None else None


def register_recheck(input: dict) -> dict:
    issue = input["issue"]
    if issue.get("status") not in OPEN_RECHECK:
        raise ValueError('只有"待复查 / 观察中"的问题需要登记复查')
    if active_round(issue) is not None:
        raise ValueError("已有一轮复查未出结论，请先记录复查结论再登记下一轮")
    subject = str(input.get("subject", "")).strip()
    owner = str(input.get("owner", "")).strip()
    due = str(input.get("due_date", "")).strip()
    if len(subject) < RECHECK_MIN_LENGTH:
        raise ValueError(
            f"请写明要复查什么（不少于 {RECHECK_MIN_LENGTH} 个字），否则到场不知道查什么"
        )
    if owner == "":
        raise ValueError("必须指定复查责任人，否则逾期了没人负责")
    if due == "":
        raise ValueError("必须填写复查目标日期，否则无法进入待办与统计")
    if not valid_day(due):
        raise ValueError("复查目标日期不是合法日期（需形如 2026-09-25，且日历上真实存在）")
    return {
        "subject": subject,
        "owner": owner,
        "dueDate": due,
        "at": input["at"],
        "by": input["by"],
        "outcome": None,
        "outcomeAt": None,
        "outcomeBy": "",
        "outcomeNote": "",
    }


def recheck_outcome(input: dict) -> dict:
    issue = input["issue"]
    round_row = active_round(issue)
    if issue.get("status") not in OPEN_RECHECK or round_row is None:
        raise ValueError("当前没有待出结论的复查轮次：请先登记复查事项与目标日期")
    note = str(input.get("note", "")).strip()
    if len(note) < RECHECK_MIN_LENGTH:
        raise ValueError(f"复查结论要写明依据（不少于 {RECHECK_MIN_LENGTH} 个字），否则等于没复查")
    outcome = input.get("outcome")
    if outcome not in {"recovered", "observing", "recurred"}:
        raise ValueError("未知的复查结论")
    next_due = str(input.get("next_due_date", "")).strip()
    if outcome == "observing" and (next_due == "" or not valid_day(next_due)):
        raise ValueError("「继续观察」必须登记合法的下一次复查目标日期")
    rounds = list(issue.get("rechecks") or [])
    closed = {
        **round_row,
        "outcome": outcome,
        "outcomeAt": input["at"],
        "outcomeBy": input["by"],
        "outcomeNote": note,
    }
    if outcome == "observing":
        rounds = [
            *rounds[:-1],
            closed,
            {
                "subject": f"观察期复查：{round_row.get('subject', '')}",
                "owner": round_row.get("owner", ""),
                "dueDate": next_due,
                "at": input["at"],
                "by": input["by"],
                "outcome": None,
                "outcomeAt": None,
                "outcomeBy": "",
                "outcomeNote": "",
            },
        ]
        status = "observing"
    else:
        rounds = [*rounds[:-1], closed]
        status = "closed" if outcome == "recovered" else "pending_review"
    return {"status": status, "rechecks": rounds}
