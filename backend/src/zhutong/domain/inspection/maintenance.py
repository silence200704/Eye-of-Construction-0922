"""保养计划与执行判定，与前端 core/maintenance/plan.ts 同口径。"""

from .schedule import valid_day


def validate_plan(draft: dict) -> list[str]:
    errors: list[str] = []
    if str(draft.get("name", "")).strip() == "":
        errors.append("计划名称必填")
    if str(draft.get("deviceId", "")).strip() == "":
        errors.append("必须选择要保养的设备")
    if str(draft.get("owner", "")).strip() == "":
        errors.append("必须指定保养负责人")
    cycle = draft.get("cycle") or {}
    if int(cycle.get("interval", 0)) < 1:
        errors.append("周期间隔至少为 1")
    if str(cycle.get("atTime", "")).strip() == "":
        errors.append("必须填写执行时刻")
    if not valid_day(str(draft.get("startDate", ""))):
        errors.append("开始日期不是合法日期")
    end = draft.get("endDate")
    if end not in (None, "") and not valid_day(str(end)):
        errors.append("结束日期不是合法日期")
    if end not in (None, "") and str(end) < str(draft.get("startDate", "")):
        errors.append("结束日期不能早于开始日期")
    checklist = draft.get("checklist") or []
    if not checklist:
        errors.append("至少要有一条保养检查项，否则执行时没有依据")
    if any(str(item.get("label", "")).strip() == "" for item in checklist):
        errors.append("检查项名称不能为空")
    return errors


def validate_completion(task: dict, answers: list[dict], measures: str, next_due: str) -> None:
    if task.get("status") == "done":
        raise ValueError("这条保养任务已经完成过了，一个周期只执行一次")
    checklist = (task.get("snapshot") or {}).get("checklist") or []
    answered = {row.get("key"): row for row in answers}
    pending = [
        item.get("label", "")
        for item in checklist
        if item.get("required") and answered.get(item.get("key"), {}).get("result") is None
    ]
    if pending:
        raise ValueError(f"还有 {len(pending)} 条必答检查项没有作答（{'、'.join(pending)}）")
    if measures.strip() == "":
        raise ValueError("必须填写维护措施，否则验收与复查没有依据")
    if not valid_day(next_due):
        raise ValueError("下次保养日期不是合法日期（需形如 2026-10-25，且日历上真实存在）")
