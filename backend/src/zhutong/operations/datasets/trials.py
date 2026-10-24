"""候选阈值试算：复用阶段 4 规则选取与判定引擎，只读、不写业务表。"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.models.archive import Device
from ...domain.monitoring.engine import STATE_LABEL, assess_record
from ...domain.monitoring.rules import rule_for_point
from ..datasets.core.record_queries import records_of_point, rules_for_dataset
from ..datasets.core.serialize import device_out, point_out, record_out
from ..datasets.core.workspace import Workspace, now_iso


@dataclass(frozen=True)
class TrialThresholds:
    """问句明确给出的候选阈值；未给出的档位沿用当前生效规则。"""

    yellow: float | None = None
    orange: float | None = None
    red: float | None = None

    def over(self, current: dict) -> dict:
        return {
            "yellow": self.yellow if self.yellow is not None else current["yellow"],
            "orange": self.orange if self.orange is not None else current["orange"],
            "red": self.red if self.red is not None else current["red"],
        }


def _device_for(session: Session, workspace: Workspace, point_id: str) -> dict | None:
    row = session.scalar(
        select(Device)
        .where(
            Device.dataset_id == workspace.dataset_id,
            Device.point_id == point_id,
            Device.status == "active",
        )
        .order_by(Device.created_at.asc())
        .limit(1)
    )
    return device_out(row) if row is not None else None


def _rows(session: Session, workspace: Workspace, point_id: str) -> list[dict]:
    return [
        record_out(row)
        for row in records_of_point(session, workspace, point_id)
        if row.quality == "valid"
    ]


def _assess(
    rows: list[dict], index: int, point: dict, rule: dict, device: dict | None
) -> tuple[dict, str]:
    row = rows[index]
    history = [item for item in rows[:index] if item["sampleTime"] <= row["sampleTime"]]
    assessment = assess_record(
        {
            "rule": rule,
            "point": point,
            "values": row["values"],
            "baselineValues": row.get("baselineValues"),
            "quality": row["quality"],
            "device": device,
            "history": [*history, row],
            "at": row["sampleTime"],
        }
    )
    original = (row.get("assessment") or {}).get("state")
    return assessment, STATE_LABEL.get(original or "normal", original or "未判定")


def simulate(session: Session, workspace: Workspace, point, thresholds: TrialThresholds) -> dict:
    """每个 ruleId 的最新版本停用或未生效时明确拒绝，不用旧版或默认阈值兜底。"""
    point_data = point_out(point)
    rule = rule_for_point(rules_for_dataset(session, workspace), point_data, now_iso())
    if rule is None or not rule.get("enabled", False):
        raise AppError(
            "NO_EFFECTIVE_RULE",
            "当前没有生效的规则可试算；请先确认规则版本，不使用旧版本或默认阈值。",
            422,
            {"pointId": point.id},
        )
    current = rule.get("thresholds") or {}
    if not current:
        raise AppError(
            "RULE_THRESHOLDS_MISSING",
            "当前生效规则没有可试算的阈值，无法用默认值替代",
            422,
            {"ruleId": rule.get("id")},
        )
    candidate = {**rule, "thresholds": thresholds.over(current), "enabled": True}
    rows = _rows(session, workspace, point.id)
    device = _device_for(session, workspace, point.id)
    out = []
    for index, row in enumerate(rows):
        assessment, original = _assess(rows, index, point_data, candidate, device)
        out.append(
            {
                "recordNo": row["recordNo"],
                "original": original,
                "candidate": STATE_LABEL.get(assessment["state"], assessment["state"]),
                "reason": assessment.get("reason") or assessment.get("insufficientReason", ""),
                "changed": assessment["state"] != (row.get("assessment") or {}).get("state"),
            }
        )
    changed = sum(1 for row in out if row["changed"])
    yellow = candidate["thresholds"]["yellow"]
    orange = candidate["thresholds"]["orange"]
    red = candidate["thresholds"]["red"]
    conclusion = (
        f"按候选阈值（黄 {yellow:g}／橙 {orange:g}／红 {red:g}）用现行判定引擎对最近 {len(out)} 条"
        f"有效记录试算，{changed} 条等级会变化；试算不写库、不触发事件。"
    )
    return {
        "conclusion": conclusion,
        "facts": [],
        "evidence": [],
        "extras": {"simulation": out, "queriedAt": now_iso(), "ruleVersion": rule.get("version")},
    }
