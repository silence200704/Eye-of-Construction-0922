"""专用演示数据：通过既有业务命令准备待办理对象。"""

from datetime import UTC, datetime, timedelta, timezone

from ..datasets import archive, assets, records, versions
from ..field import inspection, maintenance


def at(minutes=0):
    return (datetime.now(UTC) + timedelta(minutes=minutes)).isoformat()


def seed_sensor(session, workspace, location, spec):
    kind, metric, values, unit = spec
    point = assets.save_point(
        session,
        workspace,
        assets.PointWrite(
            {
                "code": f"SHOW-{kind}",
                "name": f"校园{kind}模拟监测点",
                "type": kind,
                "buildingId": location["building"],
                "floorId": location["floor"],
                "coord": {"x": 0.3 + len(location["points"]) * 0.12, "y": 0.4},
                "dataSource": "demo",
                "nfcLabel": f"SHOW-TAG-{kind}",
            },
            None,
            None,
        ),
    )
    device = assets.save_device(
        session,
        workspace,
        assets.DeviceWrite(
            {
                "code": f"SHOW-DEV-{kind}",
                "name": f"模拟{kind}设备",
                "pointId": point["id"],
                "unit": unit,
                "health": "online",
                "remark": "比赛固定模拟输入，并非真实传感器",
            },
            None,
            None,
        ),
    )
    if kind != "vibration":
        versions.save_baseline(
            session,
            workspace,
            {
                "pointId": point["id"],
                "values": {key: 0 for key in values},
                "unit": unit,
                "reason": "比赛模拟基准",
                "effectiveFrom": at(-1440),
            },
        )
    versions.create_rule(
        session,
        workspace,
        {
            "code": f"SHOW-RULE-{kind}",
            "name": "比赛模拟分级",
            "metric": metric,
            "unit": unit,
            "enabled": True,
            "buildingIds": [location["building"]],
            "pointIds": [point["id"]],
            "thresholds": {"yellow": 0.1, "orange": 0.2, "red": 0.3},
            "rateThreshold": None,
            "persistence": {
                "minRecords": 3,
                "minSpanMinutes": 10,
                "maxGapMinutes": 5,
                "level": "orange",
            },
            "recovery": {"yellowRatio": 0.8, "minRecords": 3, "minSpanMinutes": 0},
            "baselineSource": "none" if kind == "vibration" else "point",
            "effectiveFrom": at(-1440),
            "source": "比赛模拟",
            "note": "仅演示软件链路，不作为工程安全阈值",
        },
    )
    records.create_record(
        session,
        workspace,
        {
            "pointId": point["id"],
            "deviceId": device["id"],
            "values": values,
            "unit": unit,
            "sampleTime": at(-20),
            "sampleWindow": "10s" if kind == "vibration" else "",
            "source": "device",
            "quality": "valid",
            "note": "比赛模拟正常样本",
        },
    )
    location["points"].append(point["id"])
    location["devices"].append(device["id"])


def seed_tasks(session, workspace, location):
    day = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    inspection.save_plan(
        session,
        workspace,
        {
            "name": "比赛演示巡检",
            "owner": "演示巡检人员",
            "kind": "patrol",
            "buildingId": location["building"],
            "floorIds": [location["floor"]],
            "pointIds": location["points"],
            "cycle": {"unit": "day", "interval": 1, "atTime": "09:00"},
            "startDate": day,
            "executorRole": "inspector",
            "checklist": [{"key": "surface", "label": "外观与固定件是否正常", "required": True}],
        },
        None,
        None,
    )
    inspection.generate_tasks(session, workspace, day)
    maintenance.save_plan(
        session,
        workspace,
        {
            "name": "比赛设备保养",
            "owner": "演示设备管理员",
            "deviceId": location["devices"][0],
            "buildingId": location["building"],
            "cycle": {"unit": "day", "interval": 1, "atTime": "09:00"},
            "startDate": day,
            "checklist": [{"key": "fixing", "label": "固定与清洁", "required": True}],
        },
        None,
        None,
    )
    maintenance.generate(session, workspace, day)


def prepare(session, workspace):
    building = archive.save_building(
        session,
        workspace,
        {
            "code": "SHOW-CAMPUS",
            "name": "校园守护演示楼",
            "purpose": "比赛模拟",
            "footprint": {"x": 0.4, "y": 0.4, "w": 0.2, "h": 0.2, "rotate": 0},
        },
        None,
        None,
    )
    floor = archive.save_floor(
        session,
        workspace,
        {"buildingId": building["id"], "floorNo": 1, "name": "一层", "zones": [], "planVersion": 1},
        None,
        None,
    )
    location = {"building": building["id"], "floor": floor["id"], "points": [], "devices": []}
    for spec in [
        ("crack", "crack_width", {"width": 0.01}, "mm"),
        ("tilt", "tilt_xy", {"angleX": 0.01, "angleY": 0.01}, "°"),
        ("vibration", "vibration", {"accelRms": 0.01, "accelPeak": 0.02}, "m/s²"),
    ]:
        seed_sensor(session, workspace, location, spec)
    seed_tasks(session, workspace, location)
    return location
