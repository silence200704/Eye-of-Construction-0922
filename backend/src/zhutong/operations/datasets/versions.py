"""基准与规则版本：修改生成新版本，历史行原样保留。"""

import math
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Point
from ...db.models.monitoring import Baseline, MonitoringRule, RuleDefinition
from .core.helpers import get_row
from .core.serialize import baseline_out, rule_out
from .core.workspace import (
    BASELINE_ROLES,
    RULE_ROLES,
    AuditEntry,
    Workspace,
    now_iso,
    require_building,
    require_revision,
    require_role,
    uid,
    write_audit,
)

RULE_METRICS = {"crack_width", "tilt_xy", "vibration", "environment"}
RULE_METRIC_OF_POINT = {
    "crack_width": "crack_width",
    "tilt_xy": "tilt_xy",
    "vibration": "vibration",
    "temp_humidity": "environment",
}
BASELINE_FIELDS = {"crack_width": {"width"}, "tilt_xy": {"angleX", "angleY"}}


def _finite(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _check_baseline_values(metric: str, values: object) -> dict:
    if metric not in BASELINE_FIELDS:
        raise AppError("BASELINE_UNSUPPORTED", "该指标按方案不设置相对基准", 422)
    if not isinstance(values, dict):
        raise AppError("VALIDATION_FAILED", "基准值必须是数值对象", 422)
    allowed = BASELINE_FIELDS[metric]
    cleaned: dict = {}
    for key in allowed:
        value = values.get(key)
        if value is None:
            continue
        if not _finite(value):
            raise AppError("VALIDATION_FAILED", f"基准值 {key} 必须是有限数值", 422)
        cleaned[key] = float(value)
    if not cleaned:
        raise AppError("VALIDATION_FAILED", "基准值不能为空；缺项不按零处理", 422)
    return cleaned


def save_baseline(session: Session, workspace: Workspace, payload: dict) -> dict:
    require_role(workspace, BASELINE_ROLES, "基准值写入")
    point = get_row(session, Point, workspace.dataset_id, payload["pointId"], "测点")
    require_building(workspace, point.building_id)
    metric = RULE_METRIC_OF_POINT.get(point.metric)
    if metric is None:
        raise AppError("BASELINE_UNSUPPORTED", "该指标按方案不设置相对基准", 422)
    values = _check_baseline_values(metric, payload.get("values"))
    history = list(
        session.scalars(
            select(Baseline)
            .where(
                Baseline.dataset_id == workspace.dataset_id,
                Baseline.point_id == point.id,
                Baseline.metric == metric,
            )
            .order_by(Baseline.version.desc())
        )
    )
    latest = history[0].version if history else 0
    expected = payload.get("expectedVersion")
    if expected is not None and expected != latest:
        raise AppError(
            "REVISION_CONFLICT",
            "基准已被其他操作修改，请刷新后重试",
            409,
            {"expected": expected, "actual": latest},
        )
    at = now_iso()
    for row in history:
        row.current = False
    row = Baseline(
        dataset_id=workspace.dataset_id,
        id=uid("bas"),
        point_id=point.id,
        metric=metric,
        values=values,
        unit=payload.get("unit", ""),
        version=latest + 1,
        effective_from=payload.get("effectiveFrom") or at,
        reason=payload.get("reason", ""),
        created_by=workspace.actor.name,
        created_at=at,
        current=True,
    )
    session.add(row)
    session.flush()
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="baseline",
            object_id=point.id,
            object_label=f"{point.code} {point.name}",
            summary=f"基准值更新为 v{row.version}",
            reason=payload.get("reason", ""),
            at=at,
        ),
    )
    return baseline_out(row)


def list_baselines(
    session: Session, workspace: Workspace, point_id: str | None = None
) -> list[dict]:
    query = select(Baseline).where(Baseline.dataset_id == workspace.dataset_id)
    if point_id:
        query = query.where(Baseline.point_id == point_id)
    rows = session.scalars(query.order_by(Baseline.point_id.asc(), Baseline.version.desc()))
    return [baseline_out(row) for row in rows]


def _validate_thresholds(thresholds: object) -> dict | None:
    if thresholds is None:
        return None
    if not isinstance(thresholds, dict):
        raise AppError("VALIDATION_FAILED", "阈值必须是对象", 422)
    yellow = thresholds.get("yellow")
    orange = thresholds.get("orange")
    red = thresholds.get("red")
    if not all(_finite(value) for value in (yellow, orange, red)):
        raise AppError("VALIDATION_FAILED", "阈值必须是有限数值", 422)
    if not (yellow <= orange <= red):
        raise AppError("INVALID_THRESHOLDS", "阈值必须满足 黄色 ≤ 橙色 ≤ 红色", 422)
    return {"yellow": float(yellow), "orange": float(orange), "red": float(red)}


def _validate_rule(payload: dict) -> dict:
    metric = payload.get("metric")
    if metric not in RULE_METRICS:
        raise AppError("VALIDATION_FAILED", "未知规则指标", 422)
    thresholds = _validate_thresholds(payload.get("thresholds"))
    if metric == "environment" and payload.get("environment") is None:
        raise AppError("VALIDATION_FAILED", "环境规则必须配置环境条件", 422)
    if metric != "environment" and thresholds is None:
        raise AppError("VALIDATION_FAILED", "结构规则必须配置黄色/橙色/红色阈值", 422)
    persistence = payload.get("persistence")
    if not isinstance(persistence, dict) or persistence.get("level") not in {"orange", "red"}:
        raise AppError("VALIDATION_FAILED", "持续异常条件不完整", 422)
    recovery = payload.get("recovery")
    if (
        not isinstance(recovery, dict)
        or not _finite(recovery.get("yellowRatio"))
        or not _finite(recovery.get("minRecords"))
    ):
        raise AppError("VALIDATION_FAILED", "恢复条件不完整", 422)
    if not 0 < recovery["yellowRatio"] <= 1:
        raise AppError("VALIDATION_FAILED", "恢复比例必须落在 0—1", 422)
    rate_threshold = payload.get("rateThreshold")
    if rate_threshold is not None and (not _finite(rate_threshold) or rate_threshold <= 0):
        raise AppError("VALIDATION_FAILED", "变化速率阈值必须为正数", 422)
    if payload.get("rateLevel", "orange") not in {"orange", "red"}:
        raise AppError("VALIDATION_FAILED", "速率升级等级只能是橙色或红色", 422)
    if payload.get("baselineSource", "point") not in {"point", "fixed", "none"}:
        raise AppError("VALIDATION_FAILED", "基准来源无效", 422)
    return {"thresholds": thresholds}


def _next_version(current: str) -> str:
    matched = re.fullmatch(r"V?(\d+)\.(\d+)", current.strip())
    if matched is None:
        return f"V{current.count('.') + 1}.0"
    return f"V{matched.group(1)}.{int(matched.group(2)) + 1}"


def _rule_row(
    payload: dict, workspace: Workspace, rule_id: str, version: str, at: str
) -> MonitoringRule:
    return MonitoringRule(
        dataset_id=workspace.dataset_id,
        id=f"{rule_id}@{version}",
        rule_id=rule_id,
        code=payload["code"].strip(),
        name=payload["name"].strip(),
        metric=payload["metric"],
        unit=payload.get("unit", ""),
        version=version,
        effective_from=payload.get("effectiveFrom") or at,
        enabled=bool(payload.get("enabled", True)),
        building_ids=payload.get("buildingIds") or [],
        point_ids=payload.get("pointIds") or [],
        baseline_source=payload.get("baselineSource", "point"),
        fixed_baseline=payload.get("fixedBaseline"),
        thresholds=payload.get("thresholds"),
        rate_threshold=payload.get("rateThreshold"),
        rate_level=payload.get("rateLevel", "orange"),
        persistence=payload["persistence"],
        recovery=payload["recovery"],
        environment=payload.get("environment"),
        source=payload.get("source", ""),
        confirmed_by=payload.get("confirmedBy", ""),
        note=payload.get("note", ""),
        created_at=at,
        created_by=workspace.actor.name,
        updated_at=at,
        updated_by=workspace.actor.name,
    )


def create_rule(session: Session, workspace: Workspace, payload: dict) -> dict:
    require_role(workspace, RULE_ROLES, "预警规则写入")
    _validate_rule(payload)
    code = payload["code"].strip()
    rule_id = "rule_" + re.sub(r"[^a-z0-9]+", "_", code.lower()).strip("_")
    if session.get(RuleDefinition, (workspace.dataset_id, rule_id)) is not None:
        raise AppError("DUPLICATE_CODE", f"规则编号 {code} 已存在", 409)
    at = now_iso()
    session.add(RuleDefinition(dataset_id=workspace.dataset_id, id=rule_id, code=code))
    session.flush()
    row = _rule_row(payload, workspace, rule_id, "V1.0", at)
    session.add(row)
    try:
        session.flush()
    except IntegrityError as error:
        raise AppError("DUPLICATE_CODE", "规则编号重复", 409) from error
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="create",
            object_type="system",
            object_id=row.id,
            object_label=f"{row.code} {row.name}",
            summary=f"新建预警规则 {row.code}",
            at=at,
        ),
    )
    return rule_out(row)


@dataclass(frozen=True)
class RuleVersionCommand:
    rule_id: str
    payload: dict
    expected_rev: int | None
    expected_version: str | None


def save_rule_version(session: Session, workspace: Workspace, command: RuleVersionCommand) -> dict:
    require_role(workspace, RULE_ROLES, "预警规则写入")
    payload = command.payload
    _validate_rule(payload)
    definition = session.get(RuleDefinition, (workspace.dataset_id, command.rule_id))
    if definition is None:
        raise AppError("NOT_FOUND", "规则不存在", 404, {"ruleId": command.rule_id})
    latest = session.scalar(
        select(MonitoringRule)
        .where(
            MonitoringRule.dataset_id == workspace.dataset_id,
            MonitoringRule.rule_id == command.rule_id,
        )
        .order_by(MonitoringRule.effective_from.desc())
        .limit(1)
    )
    if latest is None:
        raise AppError("NOT_FOUND", "规则没有可修改的版本", 404)
    require_revision(command.expected_rev, latest)
    if command.expected_version is None:
        raise AppError("EXPECTED_VERSION_REQUIRED", "修改规则必须携带 expectedVersion", 400)
    if command.expected_version != latest.version:
        raise AppError(
            "REVISION_CONFLICT",
            "规则已生成新版本，请刷新后再修改",
            409,
            {"expectedVersion": command.expected_version, "actualVersion": latest.version},
        )
    at = now_iso()
    version = _next_version(latest.version)
    effective_from = payload.get("effectiveFrom") or at
    if effective_from < latest.effective_from:
        raise AppError("INVALID_EFFECTIVE_FROM", "新版本生效时间不能早于当前版本", 422)
    row = _rule_row(payload, workspace, command.rule_id, version, at)
    row.effective_from = effective_from
    session.add(row)
    try:
        session.flush()
    except IntegrityError as error:
        raise AppError("DUPLICATE_CODE", "规则版本重复，请重试", 409) from error
    write_audit(
        session,
        workspace,
        AuditEntry(
            action="update",
            object_type="system",
            object_id=row.id,
            object_label=f"{row.code} {row.name}",
            summary=f"修改预警规则 {row.code}：生成新版本 {latest.version} → {version}，旧版本保留",
            reason=payload.get("note", ""),
            at=at,
        ),
    )
    return rule_out(row)


def list_rules(session: Session, workspace: Workspace) -> list[dict]:
    rows = session.scalars(
        select(MonitoringRule).where(MonitoringRule.dataset_id == workspace.dataset_id)
    )
    return [rule_out(row) for row in rows]
