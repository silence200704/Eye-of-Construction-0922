"""固定模拟输入仍走真实录入、判定、事件与通知事务。"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from ...core.errors import AppError
from ...db.models.archive import Device, Point
from ...db.models.monitoring import MonitorRecord
from ..datasets import records
from .service import authorize, run_state


def sample(session, workspace, payload):
    authorize(workspace)
    run = run_state(session, workspace)
    if not run or run.state.get("phase") != "ready":
        raise AppError("STATE_CONFLICT", "请先准备并继续比赛演示，再产生模拟采样", 409)
    sensor, level = payload["sensor"], payload["level"]
    point = session.scalar(
        select(Point).where(
            Point.dataset_id == workspace.dataset_id, Point.code == f"SHOW-{sensor}"
        )
    )
    device = session.scalar(
        select(Device).where(Device.dataset_id == workspace.dataset_id, Device.point_id == point.id)
    )
    magnitude = {"normal": 0.01, "yellow": 0.12, "orange": 0.22, "red": 0.32}[level]
    values = (
        {"width": magnitude}
        if sensor == "crack"
        else {"angleX": magnitude, "angleY": magnitude / 2}
        if sensor == "tilt"
        else {"accelRms": magnitude, "accelPeak": magnitude * 2}
    )
    latest = session.scalar(
        select(MonitorRecord.sample_time)
        .where(MonitorRecord.dataset_id == workspace.dataset_id, MonitorRecord.point_id == point.id)
        .order_by(MonitorRecord.sample_time.desc())
        .limit(1)
    )
    next_time = max(
        datetime.fromisoformat(latest) + timedelta(minutes=1),
        datetime.now(UTC) - timedelta(minutes=19),
    )
    results = []
    for index in range(3 if level == "normal" else 1):
        sample_time = next_time + timedelta(minutes=index)
        if sample_time > datetime.now(UTC):
            raise AppError(
                "STATE_CONFLICT", "本轮模拟时间窗已用完，请稍候或复位演示集，不伪造未来采样", 409
            )
        results.append(
            records.create_record(
                session,
                workspace,
                {
                    "pointId": point.id,
                    "deviceId": device.id,
                    "values": values,
                    "unit": {"crack": "mm", "tilt": "°", "vibration": "m/s²"}[sensor],
                    "sampleTime": sample_time.isoformat(),
                    "sampleWindow": "10s" if sensor == "vibration" else "",
                    "source": "device",
                    "quality": "valid",
                    "note": f"比赛固定模拟输入：{level}；不是实际硬件采集",
                },
            )
        )
    return {"results": results, "source": "比赛固定模拟输入"}
