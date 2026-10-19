"""工单状态机与事件关闭处置依据，与前端 core/inspection/workOrderFlow.ts 同口径。"""

from ...operations.identity_types import ROLES

NEXT_STATUSES = {
    "created": {"assigned"},
    "assigned": {"repairing"},
    "repairing": {"submitted"},
    "submitted": {"verified", "returned"},
    "verified": set(),
    "returned": {"repairing"},
}

REPAIR_ROLES = {"repair", "property"}
VERIFY_ROLE = "safety"


def role_label(role: str) -> str:
    return ROLES.get(role, role)


def is_assigned_to(order: dict, actor: dict) -> bool:
    assignee = str(order.get("assignee", ""))
    if assignee == "":
        return False
    return assignee in {role_label(actor["role"]), actor["name"]}


def advance(input: dict) -> dict:
    order = input["order"]
    to = input["to"]
    actor = input["actor"]
    note = str(input.get("note", ""))
    if to not in NEXT_STATUSES.get(order.get("status"), set()):
        raise ValueError(f"工单当前为「{order.get('status')}」，不能直接转为「{to}」")
    if to == "assigned" and actor["role"] != "safety":
        raise ValueError("派工由学校安全管理人员执行")
    if to == "assigned" and str(order.get("assignee", "")).strip() == "":
        raise ValueError("派工必须指定维修人")
    if to in {"verified", "returned"} and actor["role"] != VERIFY_ROLE:
        raise ValueError("验收通过与验收退回由学校安全管理人员执行")
    if to in {"repairing", "submitted"}:
        if actor["role"] not in REPAIR_ROLES:
            raise ValueError("接单与提交完工由维修人员（或物业值班）执行")
        if order.get("assignee", "") == "":
            raise ValueError("工单尚未指定维修人，先派工再处理")
    if to == "repairing" and not is_assigned_to(order, actor):
        if actor["role"] != "property":
            raise ValueError(f"本工单已派给「{order.get('assignee')}」，请由被派工人接单")
        if note.strip() == "":
            raise ValueError(f"物业值班代接「{order.get('assignee')}」的工单必须写明代接原因")
    if to == "submitted" and str(order.get("measures", "")).strip() == "":
        raise ValueError("提交待验收必须填写维修措施，否则验收方没有依据")
    if to == "returned" and note.strip() == "":
        raise ValueError("验收退回必须写明退回原因")
    return {
        "assignee": order.get("assignee", ""),
        "assigned_by": order.get("assigned_by", ""),
        "assigned_at": order.get("assigned_at"),
        "due_at": order.get("due_at"),
        "measures": order.get("measures", ""),
        "materials": order.get("materials", ""),
        "photos": order.get("photos") or [],
        "submitted_at": input["at"] if to == "submitted" else order.get("submitted_at"),
    }


def issue_after_verify(issue: dict, order_no: str, at: str, by: str, by_role: str) -> dict | None:
    if issue.get("status") in {"pending_recheck", "closed"}:
        return None
    return {
        "status": "pending_recheck",
        "timeline": [
            *(issue.get("timeline") or []),
            {
                "at": at,
                "by": by,
                "byRole": by_role,
                "action": "进入待复查",
                "detail": f"工单 {order_no} 验收通过；事件关闭还需要恢复条件与处置依据",
            },
        ],
    }


def close_basis(orders: list[dict], event_id: str, no_repair_note: str) -> dict:
    related = [order for order in orders if order.get("event_id") == event_id]
    verified = [order for order in related if order.get("status") == "verified"]
    if verified:
        return {
            "ok": True,
            "kind": "work_order",
            "reason": f"关联工单 {'、'.join(order['order_no'] for order in verified)} 已验收通过",
        }
    note = no_repair_note.strip()
    if len(note) >= 10:
        return {"ok": True, "kind": "no_repair", "reason": "已填写现场核查结论（无需维修）"}
    pending = [order for order in related if order.get("status") != "verified"]
    if pending:
        return {
            "ok": False,
            "kind": "none",
            "reason": "关联工单尚未验收通过（"
            + "、".join(f"{order['order_no']} {order['status']}" for order in pending)
            + "）",
        }
    return {
        "ok": False,
        "kind": "none",
        "reason": (
            "缺少处置依据：需要有当前事件关联且验收通过的工单，"
            "或由安全管理人员填写现场核查结论（无需维修）"
        ),
    }
