"""数据集写入约定：身份、范围、epoch、乐观锁、幂等回执与审计，全部同事务。"""

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....core.errors import AppError
from ....db.models.foundation import AuditLog, Dataset, OperationReceipt
from ....operations.identity_types import Account

ARCHIVE_ROLES = {"safety", "device"}
BASELINE_ROLES = {"safety", "device"}
RULE_ROLES = {"safety", "device"}
RECORD_ROLES = {"safety", "property", "device", "inspector"}
CLOSE_ROLES = {"safety"}
NOTIFY_ROLES = {"safety", "property", "device", "inspector", "repair"}


@dataclass(frozen=True)
class Workspace:
    dataset_id: str
    epoch: int
    actor: Account


@dataclass(frozen=True)
class AuditEntry:
    action: str
    object_type: str
    object_id: str
    object_label: str
    summary: str
    reason: str = ""
    at: str | None = None


@dataclass(frozen=True)
class Command:
    """一次写命令的身份：请求、操作类型与业务载荷。"""

    request: Any
    operation: str
    payload: dict


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def dataset_of(session: Session, dataset_id: str) -> Dataset:
    dataset = session.get(Dataset, dataset_id)
    if dataset is None or not dataset.enabled:
        raise AppError("NOT_FOUND", "测试数据集不存在或已停用", 404)
    return dataset


def workspace_of(session: Session, dataset_id: str, actor: Account) -> Workspace:
    dataset = dataset_of(session, dataset_id)
    return Workspace(dataset_id=dataset.id, epoch=dataset.epoch, actor=actor)


def command_key(request: Any) -> str:
    key = request.headers.get("Idempotency-Key", "").strip()
    if not key or len(key) > 300:
        raise AppError("IDEMPOTENCY_KEY_REQUIRED", "写请求缺少有效的 Idempotency-Key", 400)
    return key


def dataset_epoch(request: Any) -> int:
    raw = request.headers.get("X-Dataset-Epoch", "").strip()
    if raw == "":
        raise AppError(
            "DATASET_EPOCH_REQUIRED", "写请求缺少 X-Dataset-Epoch，请重新读取数据集状态", 400
        )
    try:
        epoch = int(raw)
    except ValueError as error:
        raise AppError("DATASET_EPOCH_REQUIRED", "X-Dataset-Epoch 必须是整数", 400) from error
    if epoch <= 0:
        raise AppError("DATASET_EPOCH_REQUIRED", "X-Dataset-Epoch 必须是正整数", 400)
    return epoch


def require_epoch(request: Any, workspace: Workspace) -> None:
    epoch = dataset_epoch(request)
    if epoch != workspace.epoch:
        raise AppError(
            "DATASET_EPOCH_CONFLICT",
            "数据集已复位或切换，请重新读取后再写入；旧 epoch 的请求不会落库",
            409,
            {"expected": workspace.epoch, "received": epoch},
        )


def require_role(workspace: Workspace, allowed: set[str], action: str) -> None:
    if workspace.actor.role not in allowed:
        raise AppError(
            "ROLE_FORBIDDEN",
            f"当前身份不能执行{action}",
            403,
            {"role": workspace.actor.role, "allowed": sorted(allowed)},
        )


def can_access_building(workspace: Workspace, building_id: str | None) -> bool:
    allowed = workspace.actor.building_ids
    if allowed is None or building_id is None:
        return True
    return building_id in allowed


def require_building(workspace: Workspace, building_id: str) -> None:
    if not can_access_building(workspace, building_id):
        raise AppError(
            "SCOPE_FORBIDDEN", "当前身份无权访问该楼栋", 403, {"buildingId": building_id}
        )


def require_target_building(
    workspace: Workspace, building_id: str | None, label: str = "目标对象"
) -> None:
    """写目标必须能落到可授权楼栋；受限身份不能借“无测点”绕过范围。"""
    if building_id is None:
        if workspace.actor.building_ids is not None:
            raise AppError(
                "SCOPE_FORBIDDEN",
                f"{label}无法确定所属楼栋，当前身份只能操作授权范围内的对象",
                403,
            )
        return
    require_building(workspace, building_id)


def require_revision(expected: int | None, row: Any) -> None:
    if expected is None:
        raise AppError("EXPECTED_REV_REQUIRED", "修改必须携带 expectedRev，不能用过期副本覆盖", 400)
    if expected != row.revision:
        raise AppError(
            "REVISION_CONFLICT",
            "对象已被其他操作修改，请刷新后重试",
            409,
            {"expected": expected, "actual": row.revision},
        )


def bump(row: Any, workspace: Workspace, at: str | None = None) -> None:
    stamp = at or now_iso()
    row.revision += 1
    row.updated_at = stamp
    row.updated_by = workspace.actor.name


def write_audit(session: Session, workspace: Workspace, entry: AuditEntry) -> AuditLog:
    row = AuditLog(
        dataset_id=workspace.dataset_id,
        id=uid("audit"),
        at=entry.at or now_iso(),
        actor_id=workspace.actor.id,
        actor=workspace.actor.name,
        actor_role=workspace.actor.role,
        action=entry.action,
        object_type=entry.object_type,
        object_id=entry.object_id,
        object_label=entry.object_label,
        summary=entry.summary,
        reason=entry.reason,
    )
    session.add(row)
    return row


def request_digest(payload: dict) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def execute_command(
    session: Session,
    workspace: Workspace,
    command: Command,
    handler: Callable[[], dict],
) -> tuple[dict, bool]:
    """幂等命令：同键同内容复用回执；同键不同内容冲突；业务写入与回执同事务。

    摘要包含方法、路径与操作类型：同一键用于不同通知/事件/记录时不会误复用回执，
    而是返回 IDEMPOTENCY_CONFLICT。
    """
    key = command_key(command.request)
    require_epoch(command.request, workspace)
    digest = request_digest(
        {
            "method": command.request.method,
            "path": command.request.url.path,
            "operation": command.operation,
            "payload": command.payload,
        }
    )
    existing = session.scalar(
        select(OperationReceipt).where(
            OperationReceipt.dataset_id == workspace.dataset_id,
            OperationReceipt.epoch == workspace.epoch,
            OperationReceipt.actor_id == workspace.actor.id,
            OperationReceipt.operation == command.operation,
            OperationReceipt.key == key,
        )
    )
    if existing is not None:
        if existing.request_hash != digest:
            raise AppError(
                "IDEMPOTENCY_CONFLICT",
                "同一幂等键被用于不同目标或内容；请换一个键重新提交",
                409,
                {"operation": command.operation},
            )
        return dict(existing.response), True

    response = handler()
    receipt = OperationReceipt(
        dataset_id=workspace.dataset_id,
        id=uid("rcpt"),
        epoch=workspace.epoch,
        actor_id=workspace.actor.id,
        operation=command.operation,
        key=key,
        request_hash=digest,
        response=response,
        created_at=now_iso(),
    )
    session.add(receipt)
    session.flush()
    return response, False


def day_key(at: str) -> str:
    moment = datetime.fromisoformat(at[:-1] + "+00:00" if at.endswith("Z") else at)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(timezone(timedelta(hours=8))).strftime("%Y%m%d")


def next_number(session: Session, model: Any, field: Any, dataset_id: str, prefix: str) -> str:
    values = session.scalars(
        select(field).where(model.dataset_id == dataset_id, field.like(f"{prefix}%"))
    ).all()
    largest = 0
    for value in values:
        try:
            parsed = int(str(value)[len(prefix) :])
        except ValueError:
            continue
        largest = max(largest, parsed)
    return f"{prefix}{largest + 1:03d}"
