"""演示运行状态与隔离复位；只允许无范围限制的安全管理身份。"""

from sqlalchemy import delete, func, select

from ...core.errors import AppError
from ...db.database import Base
from ...db.models.field import InspectionTask, Issue, MaintenanceTask, WorkOrder
from ...db.models.foundation import Dataset, SessionState
from ...db.models.monitoring import AlarmEvent
from ..datasets.core.workspace import now_iso, require_role, uid
from . import seed


def authorize(workspace):
    require_role(workspace, {"safety"}, "演示控制")
    if workspace.dataset_id != "demo-showcase" or workspace.actor.building_ids is not None:
        raise AppError("SCOPE_FORBIDDEN", "演示控制仅用于专用演示集与完整范围的安全管理身份", 403)


def run_state(session, workspace):
    return session.get(SessionState, (workspace.dataset_id, "showcase-run"))


def status(session, workspace):
    authorize(workspace)
    row = run_state(session, workspace)
    counts = {
        name: session.scalar(
            select(func.count()).select_from(model).where(model.dataset_id == workspace.dataset_id)
        )
        for name, model in [
            ("tasks", InspectionTask),
            ("issues", Issue),
            ("orders", WorkOrder),
            ("maintenance", MaintenanceTask),
            ("events", AlarmEvent),
        ]
    }
    return {
        "runId": row.state.get("runId", "") if row else "",
        "phase": row.state.get("phase", "empty") if row else "empty",
        "epoch": session.get(Dataset, workspace.dataset_id).epoch,
        "counts": counts,
        "source": "全部硬件输入模拟",
        "location": row.state.get("location") if row else None,
    }


def action(session, workspace, kind):
    authorize(workspace)
    row = run_state(session, workspace)
    if kind == "prepare":
        if row and row.state.get("phase") in {"ready", "paused"}:
            return status(session, workspace)
        location = seed.prepare(session, workspace)
        data = {"runId": uid("run"), "phase": "ready", "location": location}
    else:
        if not row or not row.state.get("runId"):
            raise AppError("STATE_CONFLICT", "请先准备比赛数据", 409)
        data = {**row.state, "phase": "paused" if kind == "pause" else "ready"}
    if row is None:
        row = SessionState(
            dataset_id=workspace.dataset_id,
            id="showcase-run",
            actor_id=workspace.actor.id,
            kind="showcase",
            state=data,
        )
        session.add(row)
    else:
        row.state = data
    row.updated_at = now_iso()
    session.flush()
    return status(session, workspace)


def reset(session, workspace):
    authorize(workspace)
    # Leave identity, receipt history, knowledge and physical files intact. Only
    # dataset-scoped business rows are removed, within this single transaction.
    keep = {"operation_receipts", "preferences"}
    for table in reversed(Base.metadata.sorted_tables):
        if (
            "dataset_id" in table.c
            and table.name not in keep
            and not table.name.startswith("knowledge_")
        ):
            session.execute(delete(table).where(table.c.dataset_id == workspace.dataset_id))
    session.expire_all()
    dataset = session.get(Dataset, workspace.dataset_id)
    dataset.epoch += 1
    session.flush()
    return status(session, workspace)
