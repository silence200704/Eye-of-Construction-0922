"""预警事件决策：与前端 core/event/plan.ts 同口径的纯函数。"""

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

EVENT_LEVEL_RANK = {"yellow": 1, "orange": 2, "red": 3}
EVENT_LEVEL_LABEL = {"yellow": "黄色关注", "orange": "橙色排查", "red": "红色紧急核查"}
NOTIFY_POLICY = {
    "yellow": {"targets": ["点位责任人", "物业值班人员"], "dueMinutes": 30, "fallback": "替补人员"},
    "orange": {
        "targets": ["物业值班人员", "后勤主管"],
        "dueMinutes": 10,
        "fallback": "学校安全管理人员",
    },
    "red": {
        "targets": ["值班人员", "后勤主管", "安全管理人员"],
        "dueMinutes": 5,
        "fallback": "应急联系人",
    },
}


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def level_of_state(state: str) -> str | None:
    return state if state in EVENT_LEVEL_RANK else None


def build_evidence(record: dict, assessment: dict, snapshot: dict, actor: dict, at: str) -> dict:
    return {
        "recordId": record["id"],
        "recordNo": record["recordNo"],
        "sampleTime": record["sampleTime"],
        "level": level_of_state(assessment["state"]) or "yellow",
        "triggerValue": assessment["triggerValue"] if assessment["triggerValue"] is not None else 0,
        "baselineValue": assessment["baselineValue"],
        "ruleCode": snapshot["ruleCode"],
        "ruleVersion": snapshot["ruleVersion"],
        "thresholds": snapshot["thresholds"],
        "basis": assessment["basis"],
        "reason": assessment["reason"],
        "addedAt": at,
        "addedBy": actor["name"],
        "addedByRole": actor["roleLabel"],
    }


def _none() -> dict:
    return {
        "action": "none",
        "level": None,
        "evidence": None,
        "upgrade": None,
        "notifyLevel": None,
        "nextLevel": None,
        "nextPeakLevel": None,
    }


@dataclass(frozen=True)
class EventPlanInput:
    open_event: dict | None
    record: dict
    assessment: dict
    snapshot: dict
    actor: dict
    at: str


@dataclass(frozen=True)
class RevisionPlanInput(EventPlanInput):
    reason: str


def plan_event(input: EventPlanInput) -> dict:
    open_event = input.open_event
    record = input.record
    assessment = input.assessment
    snapshot = input.snapshot
    actor = input.actor
    at = input.at
    level = level_of_state(assessment["state"])
    if level is None:
        if assessment["state"] != "recovering" or open_event is None:
            return _none()
        return {
            **_none(),
            "action": "recovering",
            "nextLevel": open_event["level"],
            "nextPeakLevel": open_event["peakLevel"],
        }

    evidence = build_evidence(record, assessment, snapshot, actor, at)
    if open_event is None:
        return {
            "action": "created",
            "level": level,
            "evidence": evidence,
            "upgrade": None,
            "notifyLevel": level,
            "nextLevel": level,
            "nextPeakLevel": level,
        }

    raised = EVENT_LEVEL_RANK[level] > EVENT_LEVEL_RANK[open_event["peakLevel"]]
    upgrade = None
    if raised:
        upgrade = {
            "at": at,
            "by": actor["name"],
            "byRole": actor["roleLabel"],
            "from": open_event["peakLevel"],
            "to": level,
            "recordNo": record["recordNo"],
            "triggerValue": evidence["triggerValue"],
            "ruleVersion": snapshot["ruleVersion"],
        }
    return {
        "action": "upgraded" if raised else "appended",
        "level": level,
        "evidence": evidence,
        "upgrade": upgrade,
        "notifyLevel": level if raised else None,
        "nextLevel": level if raised else open_event["level"],
        "nextPeakLevel": level if raised else open_event["peakLevel"],
    }


def _rank_to_level(rank: int) -> str:
    if rank >= EVENT_LEVEL_RANK["red"]:
        return "red"
    if rank >= EVENT_LEVEL_RANK["orange"]:
        return "orange"
    return "yellow"


def summarize(active: list[dict], fallback: str) -> dict:
    if not active:
        return {"level": fallback, "peakLevel": fallback}
    rank = max(EVENT_LEVEL_RANK[item["level"]] for item in active)
    level = _rank_to_level(rank)
    return {"level": level, "peakLevel": level}


def plan_revision(input: RevisionPlanInput) -> dict:
    open_event = input.open_event
    record = input.record
    assessment = input.assessment
    snapshot = input.snapshot
    actor = input.actor
    at = input.at
    none = {
        "action": "none",
        "evidence": None,
        "superseded": None,
        "nextLevel": None,
        "nextPeakLevel": None,
        "notifyLevel": None,
    }
    if open_event is None:
        return none
    previous = next(
        (item for item in open_event["evidences"] if item["recordId"] == record["id"]), None
    )
    if previous is None:
        return none

    level = level_of_state(assessment["state"])
    if level is None:
        rest = [item for item in open_event["evidences"] if item["recordId"] != record["id"]]
        summary = summarize(rest, open_event["level"])
        return {
            **none,
            "action": "withdrawn",
            "superseded": previous,
            "nextLevel": summary["level"],
            "nextPeakLevel": summary["peakLevel"],
        }

    evidence = build_evidence(record, assessment, snapshot, actor, at)
    rest = [item for item in open_event["evidences"] if item["recordId"] != record["id"]]
    summary = summarize([*rest, evidence], open_event["level"])
    notify = (
        summary["level"]
        if EVENT_LEVEL_RANK[summary["level"]] > EVENT_LEVEL_RANK[open_event["level"]]
        else None
    )
    return {
        **none,
        "action": "replaced",
        "evidence": evidence,
        "superseded": previous,
        "nextLevel": summary["level"],
        "nextPeakLevel": summary["peakLevel"],
        "notifyLevel": notify,
    }


def close_guard(status: str, role_key: str) -> dict:
    if status == "closed":
        return {"allowed": False, "reason": "事件已关闭"}
    if role_key != "safety":
        return {
            "allowed": False,
            "reason": "仅学校安全管理人员可关闭事件；物业、巡检与维修角色不能关闭",
        }
    if status != "recovering":
        return {
            "allowed": False,
            "reason": "仅“恢复待确认”状态可关闭；请先确认事件并等待数据回落到恢复阈值以下",
        }
    return {"allowed": True, "reason": ""}


def notifications_for(event_id: str, event_no: str, level: str, at: str) -> list[dict]:
    policy = NOTIFY_POLICY[level]
    return [
        {
            "id": uid("ntf"),
            "eventId": event_id,
            "eventNo": event_no,
            "level": level,
            "target": target,
            "channel": "站内提醒",
            "createdAt": at,
            "presentedAt": None,
            "acknowledgedAt": None,
            "acknowledgedBy": "",
            "dueMinutes": policy["dueMinutes"],
            "fallback": policy["fallback"],
            "escalatedAt": None,
            "escalatedTo": "",
            "escalationSource": "",
        }
        for target in policy["targets"]
    ]
