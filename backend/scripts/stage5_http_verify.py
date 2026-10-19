# ruff: noqa: E501
"""阶段 5 真实 HTTP 证据入口：复用 support 中的隔离客户端与业务动作。"""

import json
import sqlite3
from datetime import UTC, datetime

from stage5_http_support import (
    DATASET,
    DB,
    OUT,
    PNG,
    Api,
    day,
    issue_body,
    order_flow,
    review,
    seed,
    stamp,
)


def main() -> None:
    api = Api()
    state = api.http.get(f"datasets/{DATASET}/state", headers=api.headers("demo-safety"))
    assert state.status_code == 200, state.text
    api.epoch = state.json()["data"]["epoch"]
    ids = seed(api)
    evidence = {"dataset": DATASET, "epoch": api.epoch, "ids": ids, "steps": []}

    plan = api.post(
        "/inspection/plans",
        {
            "name": "阶段 5 日常巡检",
            "kind": "patrol",
            "buildingId": ids["building"]["id"],
            "floorIds": [ids["floor"]["id"]],
            "pointIds": [ids["manual"]["id"]],
            "cycle": {"unit": "day", "interval": 1, "atTime": "09:00"},
            "startDate": "2026-01-01",
            "owner": "巡检负责人",
            "executorRole": "inspector",
            "checklist": [{"key": "wall", "label": "墙面", "required": True, "hint": ""}],
            "enabled": True,
        },
        "s5-plan",
    )
    generated = api.post("/inspection/tasks/generate", {"date": day()}, "s5-generate")
    task = generated["created"][0]
    wrong = api.post(
        f"/inspection/tasks/{task['id']}/check-in",
        {
            "expectedRev": task["rev"],
            "pointId": ids["manual"]["id"],
            "method": "nfc",
            "labelRead": "NFC-WRONG",
            "fallbackReason": "",
        },
        "s5-check-wrong",
        "demo-inspector",
    )
    arrived = api.post(
        f"/inspection/tasks/{task['id']}/check-in",
        {
            "expectedRev": wrong["task"]["rev"],
            "pointId": ids["manual"]["id"],
            "method": "manual",
            "labelRead": ids["manual"]["nfc"]["code"],
            "fallbackReason": "读卡失败，人工核对标签编号",
        },
        "s5-check-manual",
        "demo-inspector",
    )
    completed = api.post(
        f"/inspection/tasks/{task['id']}/complete-point",
        {
            "expectedRev": arrived["task"]["rev"],
            "pointId": ids["manual"]["id"],
            "answers": [{"key": "wall", "label": "墙面", "result": "ok", "note": ""}],
            "linkedIssueId": None,
            "noIssueReason": "",
        },
        "s5-complete",
        "demo-inspector",
    )
    evidence["steps"].append(
        {
            "step": "巡检到点与完成",
            "plan": plan["code"],
            "task": completed["task"]["taskNo"],
            "wrongLabelPassed": wrong["attempt"]["passed"],
            "attempts": len(completed["task"]["results"][0]["attempts"]),
            "status": completed["task"]["status"],
        }
    )

    media = api.upload(PNG, ids["manual"]["id"], "s5-issue-photo")
    issue = api.post(
        "/issues",
        issue_body(
            ids["manual"], "s5-repair", [{"mediaId": media["id"], "draftId": "s5-issue-draft"}]
        ),
        "s5-issue-repair",
    )["issue"]
    order = order_flow(api, issue)
    verified = api.post(
        f"/work-orders/{order['id']}/actions",
        {"expectedRev": order["rev"], "to": "verified", "note": "现场复看合格"},
        f"s5-verify-{order['id']}",
    )["order"]
    current = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    recheck = api.post(
        f"/issues/{issue['id']}/rechecks",
        {
            "expectedRev": current["rev"],
            "subject": "复查裂缝宽度",
            "owner": "学校安全管理人员",
            "dueDate": day(),
        },
        f"s5-recheck-{issue['id']}",
    )["issue"]
    closed = api.post(
        f"/issues/{issue['id']}/rechecks/outcome",
        {
            "expectedRev": recheck["rev"],
            "outcome": "recovered",
            "note": "现场复测已恢复到基准范围内",
        },
        f"s5-outcome-{issue['id']}",
    )["issue"]
    content = api.http.get(
        f"datasets/{DATASET}/media/{media['id']}/content", headers=api.headers("demo-safety")
    )
    attachment = next(row for row in api.get("/attachments") if row["issueId"] == issue["id"])
    evidence["steps"].append(
        {
            "step": "设备问题→维修→验收→复查恢复",
            "issue": issue["issueNo"],
            "order": verified["orderNo"],
            "orderStatus": verified["status"],
            "submittedAt": verified["submittedAt"],
            "issueAfterVerify": current["status"],
            "issueFinal": closed["status"],
            "attachmentBytesMatch": content.content == PNG,
            "attachmentSha256": attachment["sha256"],
            "photoDownloaded": len(content.content),
        }
    )

    structure = api.post(
        "/issues", issue_body(ids["manual"], "s5-structure"), "s5-issue-structure"
    )["issue"]
    investigated = review(
        api, structure, "to_investigate", "crack", "转专业排查：检查裂缝走向与结构连接"
    )["issue"]
    scheduled = review(api, investigated, "recheck", "remeasure", "安排复测：观察期连续三次读数")[
        "issue"
    ]
    round_one = api.post(
        f"/issues/{structure['id']}/rechecks",
        {
            "expectedRev": scheduled["rev"],
            "subject": "观察裂缝变化",
            "owner": "结构专业负责人",
            "dueDate": day(),
        },
        "s5-structure-recheck",
    )["issue"]
    observing = api.post(
        f"/issues/{structure['id']}/rechecks/outcome",
        {
            "expectedRev": round_one["rev"],
            "outcome": "observing",
            "note": "读数仍有小幅变化，继续观察",
            "nextDueDate": day(7),
        },
        "s5-structure-observe",
    )["issue"]
    recurred = api.post(
        f"/issues/{structure['id']}/rechecks/outcome",
        {
            "expectedRev": observing["rev"],
            "outcome": "recurred",
            "note": "新一轮读数再次扩大，回到待审核继续处置",
        },
        "s5-structure-recur",
    )["issue"]
    evidence["steps"].append(
        {
            "step": "结构问题→专业排查/观察→复发",
            "issue": structure["issueNo"],
            "investigating": investigated["status"],
            "observing": observing["status"],
            "recurred": recurred["status"],
            "rounds": len(recurred["rechecks"]),
        }
    )

    supplement = api.post(
        "/issues", issue_body(ids["manual"], "s5-supplement"), "s5-issue-supplement"
    )["issue"]
    returned = review(
        api, supplement, "need_evidence", "image", "退回补充：请补充裂缝全貌照片与尺度参照"
    )["issue"]
    evidence["steps"].append(
        {"step": "退回补充", "issue": supplement["issueNo"], "status": returned["status"]}
    )

    manual_order_issue = api.post(
        "/issues", issue_body(ids["manual"], "s5-acceptance-return"), "s5-issue-return"
    )["issue"]
    returned_order = order_flow(api, manual_order_issue)
    rejected = api.post(
        f"/work-orders/{returned_order['id']}/actions",
        {
            "expectedRev": returned_order["rev"],
            "to": "returned",
            "note": "照片未覆盖原要求角度，退回重做",
        },
        f"s5-return-{returned_order['id']}",
    )["order"]
    redone = api.post(
        f"/work-orders/{returned_order['id']}/actions",
        {"expectedRev": rejected["rev"], "to": "repairing"},
        f"s5-redo-{returned_order['id']}",
        "demo-repair",
    )["order"]
    resubmitted = api.post(
        f"/work-orders/{returned_order['id']}/actions",
        {"expectedRev": redone["rev"], "to": "submitted", "measures": "补拍并重新紧固"},
        f"s5-resubmit-{returned_order['id']}",
        "demo-repair",
    )["order"]
    evidence["steps"].append(
        {
            "step": "验收退回→再次办理",
            "order": returned_order["orderNo"],
            "returned": rejected["status"],
            "reviews": len(resubmitted["reviews"]),
        }
    )

    plan_body = {
        "name": "裂缝计季度保养",
        "deviceId": ids["device"]["id"],
        "buildingId": ids["building"]["id"],
        "cycle": {"unit": "day", "interval": 1, "atTime": "08:30"},
        "startDate": "2026-01-01",
        "endDate": None,
        "owner": "设备管理员",
        "checklist": [
            {"key": "bolt", "label": "固定螺栓", "required": True},
            {"key": "rust", "label": "锈蚀检查", "required": True},
        ],
        "enabled": True,
    }
    maintenance_plan = api.post("/maintenance/plans", plan_body, "s5-maintenance-plan")
    maintenance_task = api.post(
        "/maintenance/tasks/generate", {"date": day()}, "s5-maintenance-generate"
    )["created"][0]
    maintenance_photo = api.upload(PNG, ids["crack"]["id"], "s5-maintenance-photo")
    executed = api.post(
        f"/maintenance/tasks/{maintenance_task['id']}/execute",
        {
            "expectedRev": maintenance_task["rev"],
            "answers": [
                {"key": "bolt", "result": "normal"},
                {"key": "rust", "result": "abnormal"},
            ],
            "measures": "清理锈蚀并补涂防锈漆",
            "materials": "防锈漆",
            "nextDueDate": day(30),
            "note": "本次保养完成",
            "abnormalNote": "发现锚固端锈蚀",
            "createIssue": True,
            "photos": [
                {
                    "mediaId": maintenance_photo["id"],
                    "draftId": "s5-maintenance-draft",
                    "kind": "scene",
                }
            ],
        },
        "s5-maintenance-execute",
    )
    evidence["steps"].append(
        {
            "step": "保养异常转问题",
            "plan": maintenance_plan["code"],
            "task": executed["task"]["taskNo"],
            "taskStatus": executed["task"]["status"],
            "issue": executed["issue"]["issueNo"],
            "issueSource": executed["issue"]["source"],
            "bidirectional": executed["task"]["execution"]["issueId"] == executed["issue"]["id"],
        }
    )

    api.post(
        "/records",
        {
            "pointId": ids["crack"]["id"],
            "values": {"width": 0.82},
            "unit": "mm",
            "sampleTime": stamp(-30),
            "source": "manual",
            "quality": "valid",
            "note": "阶段 5 证据",
        },
        "s5-record-event",
    )
    event = api.get("/events")[0]
    sensor_issue = api.post(
        "/issues",
        {
            "source": "sensor",
            "pointId": ids["crack"]["id"],
            "buildingId": ids["building"]["id"],
            "floorId": ids["floor"]["id"],
            "anomalyType": "裂缝越限",
            "description": "预警转问题后维修",
            "submissionId": "s5-event-issue",
            "eventId": event["id"],
        },
        "s5-event-issue",
    )["issue"]
    event_order = order_flow(api, sensor_issue)
    api.post(
        f"/work-orders/{event_order['id']}/actions",
        {"expectedRev": event_order["rev"], "to": "verified", "note": "事件关联工单验收通过"},
        "s5-event-verify",
    )
    for index, width in enumerate((0.54, 0.55, 0.56)):
        api.post(
            "/records",
            {
                "pointId": ids["crack"]["id"],
                "values": {"width": width},
                "unit": "mm",
                "sampleTime": stamp(-20 + index),
                "source": "manual",
                "quality": "valid",
                "note": "恢复复测",
            },
            f"s5-recovery-{index}",
        )
    event = api.get("/events")[0]
    closed_event = api.post(
        f"/events/{event['id']}/close",
        {"expectedRev": event["rev"], "basis": "连续恢复复测与工单验收", "noRepairNote": ""},
        "s5-event-close",
    )
    again = api.try_post(
        f"/events/{event['id']}/close",
        {"expectedRev": closed_event["rev"], "basis": "再次关闭", "noRepairNote": ""},
        "s5-event-close-again",
    )
    evidence["steps"].append(
        {
            "step": "事件用当前事件已验收工单关闭",
            "event": event["eventNo"],
            "status": closed_event["status"],
            "secondClose": again.status_code,
            "closeTimeline": closed_event["timeline"][-1]["detail"],
        }
    )

    indicators = api.get("/reports/indicators")
    issue_export = api.get("/reports/export?kind=issues")
    task_export = api.get("/reports/export?kind=tasks")
    event_report = api.get(f"/reports/events/{event['id']}")
    evidence["reports"] = {
        "indicatorKeys": [row["key"] for row in indicators["indicators"]],
        "indicatorValues": [row["value"] for row in indicators["indicators"]],
        "issueExportRows": issue_export["count"],
        "taskExportStatuses": [row[5] for row in task_export["rows"]],
        "eventReportClosed": event_report["closed"],
        "eventReportSections": [row["title"] for row in event_report["sections"]],
    }

    database = sqlite3.connect(DB)
    audits = database.execute(
        "select count(*) from audits where dataset_id=?", (DATASET,)
    ).fetchone()[0]
    receipts = database.execute(
        "select count(*) from operation_receipts where dataset_id=?", (DATASET,)
    ).fetchone()[0]
    operations = [
        row[0]
        for row in database.execute(
            "select distinct operation from operation_receipts where dataset_id=? order by operation",
            (DATASET,),
        )
    ]
    object_ids = [issue["id"], order["id"], task["id"], maintenance_task["id"], event["id"]]
    audit_rows = database.execute(
        "select object_id, summary from audits where dataset_id=? and object_id in ({})".format(
            ",".join("?" * len(object_ids))
        ),
        (DATASET, *object_ids),
    ).fetchall()
    database.close()
    evidence["database"] = {
        "audits": audits,
        "receipts": receipts,
        "operations": operations,
        "objectAudits": [{"objectId": row[0], "summary": row[1]} for row in audit_rows],
    }
    evidence["generatedAt"] = datetime.now(UTC).isoformat()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {"ok": True, "evidence": str(OUT), "steps": len(evidence["steps"])}, ensure_ascii=False
        )
    )


if __name__ == "__main__":
    main()
