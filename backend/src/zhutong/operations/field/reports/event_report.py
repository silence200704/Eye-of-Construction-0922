"""单事件处置报告：为何预警、谁确认、谁处置、为何关闭。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from ....core.errors import AppError
from ....db.models.archive import Device, Point
from ....db.models.field import Issue, WorkOrder
from ....db.models.monitoring import AlarmEvent, AlarmNotification
from ...datasets.core.workspace import Workspace
from .types import (
    EVENT_LEVEL,
    ISSUE_STATUS,
    ORDER_STATUS,
    OUTCOME_LABEL,
    REVIEW_LABEL,
    SOURCE_LABEL,
    fmt,
    or_none,
    scoped,
    time_or_none,
)


def _evidence_section(event: AlarmEvent, point: Point | None, device: Device | None) -> dict:
    rows = [
        {"label": "事件编号", "value": event.event_no},
        {
            "label": "测点",
            "value": "（测点档案已删除）" if point is None else f"{point.code} {point.name}",
        },
        {
            "label": "设备",
            "value": "（未绑定设备）" if device is None else f"{device.code} {device.name}",
        },
        {"label": "触发规则", "value": f"{event.rule_code}（单位 {event.unit}）"},
        {"label": "当前等级", "value": EVENT_LEVEL.get(event.level, event.level)},
        {
            "label": "历史最高等级",
            "value": EVENT_LEVEL.get(event.peak_level, event.peak_level),
        },
        {"label": "产生时间", "value": fmt(event.opened_at)},
        {
            "label": "最近触发",
            "value": (
                f"{fmt(event.last_trigger_at)}，触发值 {event.last_trigger_value:g}{event.unit}"
            ),
        },
        {"label": "活跃证据", "value": f"{len(event.evidences or [])} 条"},
    ]
    for index, item in enumerate(event.evidences or []):
        rows.append(
            {
                "label": f"证据 {index + 1}",
                "value": (
                    f"{item.get('recordNo')}（采样 {fmt(item.get('sampleTime'))}）"
                    f"触发值 {item.get('triggerValue')}，基准 "
                    f"{item.get('baselineValue', '（无）')}，"
                    f"规则版本 {item.get('ruleVersion')}；"
                    f"判定：{or_none(item.get('reason'))}"
                ),
            }
        )
    superseded = event.superseded_evidences or []
    if superseded:
        rows.append(
            {
                "label": "已替代证据",
                "value": f"{len(superseded)} 条（保留审计，不参与当前判定）",
            }
        )
    return {"title": "一、事件与证据", "question": "为何预警", "rows": rows}


def _notify_section(event: AlarmEvent, notifications: list[AlarmNotification]) -> dict:
    rows = [
        {
            "label": "确认状态",
            "value": "未确认"
            if not event.acknowledged_at
            else (
                f"已确认：{time_or_none(event.acknowledged_at)}，{or_none(event.acknowledged_by)}"
            ),
        },
        {
            "label": "站内提醒",
            "value": "（无提醒记录）" if not notifications else f"{len(notifications)} 条",
        },
    ]
    for index, item in enumerate(notifications):
        states = [
            "已生成",
            f"已展示 {time_or_none(item.presented_at)}",
            "未确认"
            if not item.acknowledged_at
            else (f"已确认 {time_or_none(item.acknowledged_at)} {item.acknowledged_by}"),
        ]
        escalation = (
            "未升级"
            if not item.escalated_at
            else (
                f"已升级至 {item.escalated_to}"
                f"（{'演示模式模拟' if item.escalation_source == 'demo' else '按演示时限超时'}）"
            )
        )
        rows.append(
            {
                "label": f"提醒 {index + 1}",
                "value": (
                    f"接收 {item.target}（{item.channel}）：{'；'.join(states)}；{escalation}"
                ),
            }
        )
    rows.append(
        {
            "label": "通知渠道说明",
            "value": "演示只记录站内提醒的生成、展示与确认；未接入短信或推送渠道，因此不声称送达。",
        }
    )
    return {"title": "二、提醒与确认", "question": "谁收到、谁确认", "rows": rows}


def _disposal_section(issues: list[Issue], orders: list[WorkOrder]) -> dict:
    rows: list[dict] = []
    if not issues and not orders:
        rows.append({"label": "处置记录", "value": "（未转问题、也未建工单）"})
    for issue in issues:
        rows.append(
            {
                "label": f"问题 {issue.issue_no}",
                "value": (
                    f"来源 {SOURCE_LABEL.get(issue.source, issue.source)}，"
                    f"异常类型 {issue.anomaly_type}；"
                    f"状态 {ISSUE_STATUS.get(issue.status, issue.status)}；"
                    f"审核出口 {REVIEW_LABEL.get(issue.review_action or '', '未审核')}"
                    f"（{or_none(issue.review_category)}）；"
                    f"审核时间 {time_or_none(issue.reviewed_at)}"
                ),
            }
        )
        rows.append(
            {
                "label": f"问题 {issue.issue_no} 描述",
                "value": or_none(issue.description),
            }
        )
        for index, check in enumerate(issue.rechecks or []):
            rows.append(
                {
                    "label": f"问题 {issue.issue_no} 复查 {index + 1}",
                    "value": (
                        f"{check.get('subject')}；负责人 {check.get('owner')}；"
                        f"登记 {time_or_none(check.get('at'))}；"
                        f"结论 {OUTCOME_LABEL.get(check.get('outcome') or '', '尚未提交')}；"
                        f"{time_or_none(check.get('outcomeAt'))} "
                        f"{check.get('outcomeBy', '')}；"
                        f"{or_none(check.get('outcomeNote'))}"
                    ),
                }
            )
        if not any(check.get("outcome") for check in issue.rechecks or []):
            rows.append({"label": f"问题 {issue.issue_no} 闭环缺项", "value": "缺少复查结论"})
    for order in orders:
        rows.append(
            {
                "label": f"工单 {order.order_no}",
                "value": (
                    f"状态 {ORDER_STATUS.get(order.status, order.status)}；"
                    f"维修人 {or_none(order.assignee)}；"
                    f"派工时间 {time_or_none(order.assigned_at)}；"
                    f"提交完工 {time_or_none(order.submitted_at)}；"
                    f"完工照片 {len(order.photos or [])} 张"
                ),
            }
        )
        rows.append(
            {
                "label": f"工单 {order.order_no} 措施",
                "value": or_none(order.measures),
            }
        )
        rows.append(
            {
                "label": f"工单 {order.order_no} 材料",
                "value": or_none(order.materials),
            }
        )
        for index, review in enumerate(order.reviews or []):
            rows.append(
                {
                    "label": f"验收 {index + 1}",
                    "value": (
                        f"{'验收通过' if review.get('action') == 'verify' else '验收退回'}"
                        f"（{'合格' if review.get('result') == 'pass' else '不合格'}）："
                        f"{time_or_none(review.get('at'))}，{review.get('by')}"
                        f"（{review.get('byRole')}）；"
                        f"意见：{or_none(review.get('note'))}"
                    ),
                }
            )
    return {"title": "三、问题与工单", "question": "谁处置、如何验收", "rows": rows}


def _close_section(event: AlarmEvent) -> dict:
    rows = [
        {
            "label": "关闭状态",
            "value": "事件尚未关闭"
            if not event.closed_at
            else (f"已于 {time_or_none(event.closed_at)} 由 {or_none(event.closed_by)} 关闭"),
        },
        {
            "label": "关闭依据",
            "value": "（未填写）" if not event.closed_at else or_none(event.close_basis),
        },
        {"label": "备注", "value": or_none(event.note)},
    ]
    return {"title": "四、关闭依据", "question": "为何关闭", "rows": rows}


def _timeline(event: AlarmEvent, issues: list[Issue], orders: list[WorkOrder]) -> list[dict]:
    rows = [
        {
            "at": row.get("at"),
            "by": row.get("by"),
            "action": row.get("action"),
            "detail": row.get("detail", ""),
        }
        for row in event.timeline or []
    ]
    for issue in issues:
        rows.extend(
            {
                "at": row.get("at"),
                "by": row.get("by"),
                "action": f"问题 {issue.issue_no}：{row.get('action')}",
                "detail": row.get("detail", ""),
            }
            for row in issue.timeline or []
        )
    for order in orders:
        rows.extend(
            {
                "at": row.get("at"),
                "by": row.get("by"),
                "action": f"工单 {order.order_no}：{row.get('action')}",
                "detail": row.get("detail", ""),
            }
            for row in order.timeline or []
        )
    rows.sort(key=lambda row: str(row.get("at") or ""))
    return rows


def event_report(session: Session, workspace: Workspace, event_id: str) -> dict:
    event = session.get(AlarmEvent, (workspace.dataset_id, event_id))
    if event is None:
        raise AppError("NOT_FOUND", "预警事件不存在", 404, {"eventId": event_id})
    point = session.get(Point, (workspace.dataset_id, event.point_id))
    building_id = point.building_id if point is not None else None
    if not scoped(workspace, building_id):
        raise AppError("SCOPE_FORBIDDEN", "当前身份无权访问该事件所在楼栋", 403)
    device = session.scalar(
        select(Device).where(
            Device.dataset_id == workspace.dataset_id,
            Device.point_id == event.point_id,
        )
    )
    notifications = list(
        session.scalars(
            select(AlarmNotification).where(
                AlarmNotification.dataset_id == workspace.dataset_id,
                AlarmNotification.event_id == event.id,
            )
        )
    )
    issues = list(
        session.scalars(
            select(Issue).where(
                Issue.dataset_id == workspace.dataset_id,
                Issue.event_id == event.id,
            )
        )
    )
    issue_ids = {issue.id for issue in issues}
    orders = [
        order
        for order in session.scalars(
            select(WorkOrder).where(WorkOrder.dataset_id == workspace.dataset_id)
        )
        if order.event_id == event.id or (order.issue_id and order.issue_id in issue_ids)
    ]
    return {
        "eventId": event.id,
        "eventNo": event.event_no,
        "title": f"{event.event_no} 处置报告",
        "closed": event.closed_at is not None,
        "buildingId": building_id,
        "pointId": event.point_id,
        "sections": [
            _evidence_section(event, point, device),
            _notify_section(event, notifications),
            _disposal_section(issues, orders),
            _close_section(event),
        ],
        "timeline": _timeline(event, issues, orders),
    }
