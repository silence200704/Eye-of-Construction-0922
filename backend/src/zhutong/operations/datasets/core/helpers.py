"""档案服务共用的小工具：取对象、编号唯一性、坐标与审计。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....core.errors import AppError
from ....db.models.archive import Point
from .workspace import Workspace, write_audit


def get_row(session: Session, model: Any, dataset_id: str, object_id: str, label: str) -> Any:
    row = session.get(model, (dataset_id, object_id))
    if row is None:
        raise AppError("NOT_FOUND", f"{label}不存在", 404, {"id": object_id})
    return row


def ensure_code(
    session: Session, model: Any, workspace: Workspace, code: str, exclude: str | None = None
) -> None:
    found = session.scalar(
        select(model.id).where(model.dataset_id == workspace.dataset_id, model.code == code)
    )
    if found is not None and found != exclude:
        raise AppError("DUPLICATE_CODE", f"编号 {code} 已被占用", 409, {"code": code})


def ensure_nfc(
    session: Session, workspace: Workspace, label: str, exclude: str | None = None
) -> None:
    found = session.scalar(
        select(Point.id).where(
            Point.dataset_id == workspace.dataset_id,
            Point.status == "active",
            Point.nfc_code == label,
        )
    )
    if found is not None and found != exclude:
        raise AppError("DUPLICATE_NFC", f"NFC 标签 {label} 已绑定在 {found}", 409, {"nfc": label})


def coord_of(payload: dict, prefix: str = "") -> tuple[float, float]:
    coord = payload.get(prefix) or {}
    x = coord.get("x")
    y = coord.get("y")
    if (
        not isinstance(x, (int, float))
        or isinstance(x, bool)
        or not isinstance(y, (int, float))
        or isinstance(y, bool)
    ):
        raise AppError("VALIDATION_FAILED", "坐标必须是数值", 422)
    if not (0 <= x <= 1 and 0 <= y <= 1):
        raise AppError("INVALID_COORDINATE", "坐标必须落在 0—1 的底图范围内", 422, {"x": x, "y": y})
    return float(x), float(y)


def audit_archive(
    session: Session,
    workspace: Workspace,
    kind: str,
    row: Any,
    label: str,
    created: bool,
    at: str,
) -> None:
    write_audit(
        session,
        workspace,
        action="create" if created else "update",
        object_type=kind,
        object_id=row.id,
        object_label=label,
        summary=f"{'新建' if created else '修改'}{label}",
        at=at,
    )
