"""读写和回执重放共用的当前权限，状态转移仍由既有领域规则执行。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....core.errors import AppError
from ....db.models.field import Issue, WorkOrder
from ....db.models.foundation import AuditLog
from ...datasets.core.workspace import Workspace, require_role
from ..common import get_issue, get_order, point_of


def supplement_owner(session: Session, workspace: Workspace, issue_id: str) -> Issue:
    issue = get_issue(session, workspace, issue_id)
    require_role(workspace, {"safety", "property", "device", "inspector", "repair"}, "补充材料")
    creator = session.scalar(
        select(AuditLog.actor_id)
        .where(
            AuditLog.dataset_id == workspace.dataset_id,
            AuditLog.object_id == issue.id,
            AuditLog.action == "create",
        )
        .limit(1)
    )
    if creator != workspace.actor.id:
        raise AppError("ROLE_FORBIDDEN", "仅原上报身份可以补充材料；姓名相同不授予权限", 403)
    if issue.point_id:
        point_of(session, workspace, issue.point_id)
    return issue


def order_action(session: Session, workspace: Workspace, order_id: str, payload: dict) -> WorkOrder:
    order = get_order(session, workspace, order_id)
    role, actor, to = workspace.actor.role, workspace.actor.id, payload.get("to")
    allowed = (
        role == "safety"
        if to in {"assigned", "verified", "returned"}
        else role in {"repair", "property"}
    )
    if to == "repairing":
        allowed = (
            allowed
            and bool(order.assignee_id)
            and (
                actor == order.assignee_id
                or (role == "property" and bool(str(payload.get("note", "")).strip()))
            )
        )
    elif to == "submitted":
        allowed = allowed and bool(order.accepted_by_id) and actor == order.accepted_by_id
    if not allowed:
        raise AppError(
            "STATE_CONFLICT",
            "当前身份无权执行该工单动作；请由指定维修人或实际接单人办理，物业代接必须写原因",
            409,
        )
    return order
