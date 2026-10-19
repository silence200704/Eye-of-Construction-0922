"""数据集路由共用依赖：读写会话、数据集上下文与响应信封。"""

from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ...core.http import ok
from ...db.models.archive import Building, Device, Floor, Point
from ...db.models.monitoring import AlarmEvent, Baseline, MonitoringRule, MonitorRecord
from ...operations.datasets.core.workspace import Workspace, workspace_of
from ..dependencies import Actor

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}", tags=["数据集"])


def read_session(request: Request) -> Iterator[Session]:
    with request.app.state.database.sessions() as session:
        yield session


def write_session(request: Request) -> Iterator[Session]:
    with request.app.state.database.sessions.begin() as session:
        session.execute(text("BEGIN IMMEDIATE"))
        yield session


def workspace(request: Request, dataset_id: str, actor: Actor) -> Workspace:
    with request.app.state.database.sessions() as session:
        return workspace_of(session, dataset_id, actor)


Read = Annotated[Session, Depends(read_session)]
# 提交与提交错误必须发生在发送响应前，避免 200 已发出但事务尚未完成。
Write = Annotated[Session, Depends(write_session, scope="function")]
Current = Annotated[Workspace, Depends(workspace)]


def reply(
    request: Request,
    current: Workspace,
    data: object,
    rev: int | None = None,
    replayed: bool = False,
) -> dict:
    return ok(request, data, rev=rev, replayed=replayed, meta={"datasetEpoch": current.epoch})


@router.get("/state")
def dataset_state(request: Request, session: Read, current: Current) -> dict:
    counts = {}
    for name, model in (
        ("buildings", Building),
        ("floors", Floor),
        ("points", Point),
        ("devices", Device),
        ("baselines", Baseline),
        ("rules", MonitoringRule),
        ("records", MonitorRecord),
        ("events", AlarmEvent),
    ):
        counts[name] = session.scalar(
            select(func.count()).select_from(model).where(model.dataset_id == current.dataset_id)
        )
    return reply(
        request, current, {"id": current.dataset_id, "epoch": current.epoch, "counts": counts}
    )
