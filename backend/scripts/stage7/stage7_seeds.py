# ruff: noqa: E501
"""阶段 7 固定前置业务数据：问题/工单、知识库与影像会话。"""

import json
import sqlite3
from pathlib import Path

from stage7_http_support import Api, mp4, stamp


def issue_body(point: dict, submission: str) -> dict:
    return {
        "source": "report",
        "pointId": point["id"],
        "buildingId": point["buildingId"],
        "floorId": point["floorId"],
        "anomalyType": "裂缝越限",
        "description": "阶段 7 固定前置问题",
        "submissionId": submission,
    }


def seed_field(api: Api, ids: dict, event: dict) -> dict:
    sensor = api.post(
        "/issues",
        {
            **issue_body(ids["crack"], "s7-sensor-issue"),
            "source": "sensor",
            "eventId": event["id"],
        },
        "s7-sensor-issue-key",
    )["issue"]
    reviewed = api.post(
        f"/issues/{sensor['id']}/review",
        {
            "expectedRev": sensor["rev"],
            "action": "to_repair",
            "category": "equipment",
            "note": "现场核实后转维修处理",
        },
        "s7-review-repair",
    )
    order = reviewed["order"]
    order = api.post(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "assigned", "assigneeId": "demo-repair"},
        "s7-assign",
    )["order"]
    order = api.post(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "repairing"},
        "s7-accept",
        "demo-repair",
    )["order"]
    order = api.post(
        f"/work-orders/{order['id']}/actions",
        {
            "expectedRev": order["rev"],
            "to": "submitted",
            "measures": "更换固定件并复紧",
            "materials": "固定件",
            "photos": [],
        },
        "s7-submit",
        "demo-repair",
    )["order"]
    closing = api.post(
        "/issues", issue_body(ids["manual"], "s7-manual-issue"), "s7-manual-issue-key"
    )["issue"]
    api.post(
        f"/issues/{closing['id']}/review",
        {
            "expectedRev": closing["rev"],
            "action": "close_no_fault",
            "category": "no_fault",
            "note": "现场核查确认无结构异常，无需维修",
        },
        "s7-review-close",
    )
    return {
        "issue": next(row for row in api.get("/issues") if row["id"] == sensor["id"]),
        "order": order,
        "closedIssue": closing,
    }


def seed_knowledge(api: Api) -> dict:
    first = api.post(
        "/knowledge/documents",
        {
            "title": "预警分级与处置要求",
            "sourcePath": "docs/knowledge/预警分级.md",
            "sourceKind": "project",
            "roles": ["safety", "property", "device", "inspector", "repair"],
            "content": "# 预警分级\n\n红色为紧急核查门槛，需要学校安全管理人员立即确认并组织核查。\n确认后进入处理中，处置完成后仍需恢复复测满足条件才能关闭。",
        },
        "s7-knowledge-doc-1",
    )
    second = api.post(
        "/knowledge/documents",
        {
            "title": "工单验收要求",
            "sourcePath": "docs/knowledge/工单验收.md",
            "sourceKind": "project",
            "roles": ["safety", "property", "device", "inspector", "repair"],
            "content": "# 工单验收\n\n维修工单由学校安全管理人员验收，维修人员不能自行验收。\n验收通过只进入待复查，不直接关闭问题。",
        },
        "s7-knowledge-doc-2",
    )
    api.post(
        "/knowledge/faqs",
        {
            "chunkId": first["chunks"][0]["id"],
            "questions": ["红色预警代表什么要求", "红色预警怎么处置"],
        },
        "s7-faq-1",
    )
    api.post(
        "/knowledge/faqs",
        {
            "chunkId": second["chunks"][0]["id"],
            "questions": ["工单验收由谁负责", "维修人员能自己验收吗"],
        },
        "s7-faq-2",
    )
    return {"first": first, "second": second}


def seed_media(api: Api, point_id: str) -> dict:
    before = api.upload(point_id, "s7-media-before")
    after = api.upload(point_id, "s7-media-after")
    first = api.post(
        "/media-sessions/frames",
        {
            "mediaId": before["id"],
            "pointId": point_id,
            "label": "处置前",
            "capturedAt": stamp(-120),
        },
        "s7-frame-before",
    )
    second = api.post(
        "/media-sessions/frames",
        {"mediaId": after["id"], "pointId": point_id, "label": "处置后", "capturedAt": stamp(-60)},
        "s7-frame-after",
    )
    saved = api.post(
        "/media-sessions/comparisons",
        {
            "pointId": point_id,
            "beforeId": first["id"],
            "afterId": second["id"],
            "result": {
                "changedRatio": 0.021,
                "maxRegionRatio": 0.018,
                "region": {"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.5},
                "status": "changed",
                "note": "像素差统计",
                "source": "session",
            },
        },
        "s7-compare",
    )
    return {
        "before": before,
        "after": after,
        "frame": first,
        "secondFrame": second,
        "comparison": saved,
    }


def seed_second_issue(api: Api, point: dict) -> dict:
    return api.post(
        "/issues",
        {
            "source": "report",
            "pointId": point["id"],
            "buildingId": point["buildingId"],
            "floorId": point["floorId"],
            "anomalyType": "裂缝宽度复核",
            "description": "同一测点的第二次独立上报",
            "submissionId": "s7-second-issue",
        },
        "s7-second-issue-key",
    )["issue"]


def seed_video(api: Api, point_id: str) -> dict:
    media = api.upload(
        point_id,
        "s7-video",
        mime="video/mp4",
        filename="stage7.mp4",
        data=mp4(),
        origin="demo_generated",
    )
    frame_media = api.upload(
        point_id,
        "s7-video-frame-media",
        origin="demo_generated",
        filename="stage7-frame.png",
    )
    video = api.post(
        "/media-sessions/videos",
        {
            "mediaId": media["id"],
            "pointId": point_id,
            "metadata": {
                "fileName": "stage7.mp4",
                "title": "固定机位演示视频",
                "source": "随包演示素材",
                "assetKey": "stage7",
                "comparable": True,
                "note": "合成演示视频，非真实连续拍摄",
            },
        },
        "s7-video-register",
    )
    frames = []
    for time_code, label, minutes, key in (
        (3.0, "首帧", -30, "s7-video-frame"),
        (6.0, "中帧", -25, "s7-video-frame-mid"),
        (9.0, "末帧", -20, "s7-video-frame-last"),
    ):
        frames.append(
            api.post(
                "/media-sessions/frames",
                {
                    "mediaId": frame_media["id"],
                    "pointId": point_id,
                    "label": f"视频抽帧｜{label}",
                    "capturedAt": stamp(minutes),
                    "timeCode": time_code,
                    "videoId": video["id"],
                },
                key,
            )
        )
    api.post(
        f"/media-sessions/videos/{video['id']}/analysis",
        {
            "analysis": {
                "videoId": video["id"],
                "pointId": point_id,
                "frameIds": [row["id"] for row in frames],
                "regions": {
                    "crack": {
                        "beforeId": frames[0]["id"],
                        "afterId": frames[2]["id"],
                        "region": {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.4},
                        "changedRatio": 0.12,
                        "status": "changed",
                        "summary": "区域像素差统计，不给毫米数",
                    },
                    "control": {
                        "beforeId": frames[0]["id"],
                        "afterId": frames[2]["id"],
                        "region": {"x": 0.5, "y": 0.1, "w": 0.3, "h": 0.3},
                        "changedRatio": 0,
                        "status": "stable",
                        "summary": "完好墙面未见明显差异",
                    },
                },
                "reason": "合成演示视频，非真实连续拍摄",
            }
        },
        "s7-video-analysis",
    )
    return {"media": media, "video": video, "frames": frames, "frame": frames[0]}


def add_scoped_user(db_path: Path, user_id: str, building_ids: list[str]) -> None:
    connection = sqlite3.connect(db_path)
    try:
        connection.execute(
            "INSERT OR REPLACE INTO users (id,name,role,enabled,is_demo,building_ids_json) VALUES (?,?,?,?,?,?)",
            (user_id, "范围受限验证身份", "safety", 1, 1, json.dumps(building_ids)),
        )
        connection.commit()
    finally:
        connection.close()
