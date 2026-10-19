"""在 backend 目录运行；全部业务复现只写入独立临时库。"""

import json
import logging
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from zhutong.app import create_app
from zhutong.bootstrap import initialize
from zhutong.core.settings import Settings

sys.path.insert(0, str(Path("tests").resolve()))
from field.fixtures import FieldApi, today  # noqa: E402

logging.disable(logging.CRITICAL)
results = []


def record(case, response, **extra):
    results.append({"case": case, "http": response.status_code, **extra})
    return response.json().get("data", {})


def set_scope(engine, value):
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE users SET building_ids_json=:scope WHERE id='demo-safety'"),
            {"scope": value},
        )


with tempfile.TemporaryDirectory(
    prefix="zhutong-stage5-audit-", ignore_cleanup_errors=True
) as directory:
    settings = Settings(
        database_url="sqlite:///" + (Path(directory) / "audit.sqlite").as_posix(),
        runtime_dir=Path(directory),
        secret_key="review-only-signing-key-not-production",
        demo_mode=True,
    )
    initialize(settings)
    engine = create_engine(str(settings.database_url))
    with TestClient(create_app(settings), raise_server_exceptions=False) as client:
        api = FieldApi(client, str(settings.database_url))
        ids = api.seed_manual_point()
        point = ids["manual"]
        plan = api.create_plan(point["id"], point["buildingId"], point["floorId"])
        api.generate(key=f"inspection_generate|{today()}")
        task = api.task_for_point(point["id"])
        api.create_maintenance_plan(ids["device"]["id"], point["buildingId"])
        mt = api.generate_maintenance()["created"][0]
        issue = api.report_issue(point, submissionId="scope-review")["issue"]
        manual = api.ok_post(
            "/work-orders", {"pointId": point["id"], "title": "scope order"}, "manual-scope"
        )["order"]
        with engine.connect() as conn:
            original = conn.execute(
                text("select building_ids_json from users where id='demo-safety'")
            ).scalar_one()
        set_scope(engine, "[]")
        response = api.fpost(
            f"/issues/{issue['id']}/review",
            {
                "expectedRev": issue["rev"],
                "action": "recheck",
                "category": "remeasure",
                "note": "越权审核范围外的问题",
            },
            "scope-review",
        )
        data = record("safety empty building scope reviews issue", response)
        response = api.fpost(
            f"/inspection/plans/{plan['id']}/enabled",
            {"expectedRev": plan["rev"], "enabled": False},
            "scope-plan",
        )
        record("empty building scope toggles inspection plan", response)
        response = api.fpost(
            f"/work-orders/{manual['id']}/actions",
            {"expectedRev": manual["rev"], "to": "assigned", "assignee": "演示维修人员"},
            "scope-assign",
        )
        record("empty building scope assigns work order", response)
        response = api.fpost(
            f"/maintenance/tasks/{mt['id']}/execute",
            {
                "expectedRev": mt["rev"],
                "answers": [
                    {"key": "bolt", "result": "normal"},
                    {"key": "rust", "result": "normal"},
                ],
                "measures": "范围外保养任务也提交成功",
                "nextDueDate": today(),
            },
            "scope-maint",
        )
        record("empty building scope executes maintenance without photos", response)
        set_scope(engine, original)
        order = api.ok_post(
            "/work-orders", {"pointId": point["id"], "title": "assignee bypass"}, "manual-steal"
        )["order"]
        assigned = api.advance(order, "assigned", assignee="其他维修人员")["order"]
        response = api.fpost(
            f"/work-orders/{order['id']}/actions",
            {"expectedRev": assigned["rev"], "to": "repairing", "assignee": "演示维修人员"},
            "steal-assignee",
            "demo-repair",
        )
        stolen = record("repair actor overrides assignee while accepting", response)
        if stolen:
            results[-1].update(
                {
                    "beforeAssignee": assigned["assignee"],
                    "afterAssignee": stolen["order"]["assignee"],
                    "status": stolen["order"]["status"],
                }
            )
        api.add_record(ids["point"]["id"], 0.82, minutes=-40)
        event = api.get("/events")[0]
        fake = api.report_issue(point, submissionId="spoof-event", eventId=event["id"])["issue"]
        order = api.review(fake, "to_repair", "equipment")["order"]
        order = api.advance(order, "assigned", assignee="演示维修人员")["order"]
        order = api.advance(order, "repairing", account="demo-repair")["order"]
        order = api.advance(
            order, "submitted", account="demo-repair", measures="维修的是另一个人工测点"
        )["order"]
        api.advance(order, "verified", note="另一个测点维修验收通过")
        for index, width in enumerate((0.54, 0.55, 0.56)):
            api.add_record(ids["point"]["id"], width, minutes=-20 + index * 2)
        event = api.get("/events")[0]
        response = api.fpost(
            f"/events/{event['id']}/close",
            {
                "expectedRev": event["rev"],
                "basis": "用人工问题私填的其他测点工单作为依据",
                "noRepairNote": "",
            },
            "spoof-close",
        )
        record(
            "manual issue for another point can forge current event work order and close",
            response,
            eventPoint=event["pointId"],
            workOrderPoint=order["pointId"],
            issueSource=fake["source"],
            workOrderEvent=order["eventId"],
        )
        issue2 = api.report_issue(point, submissionId="duplicate-review")["issue"]
        first = api.review(issue2, "to_repair", "equipment")
        response = api.fpost(
            f"/issues/{issue2['id']}/review",
            {
                "expectedRev": first["issue"]["rev"],
                "action": "to_repair",
                "category": "equipment",
                "note": "再次点击转维修重复创建工单",
            },
            "duplicate-review-second",
        )
        second = record("same issue reviewed to repair twice with fresh key", response)
        if second:
            results[-1]["workOrderCount"] = len(second["issue"]["workOrderIds"])
        issue2 = api.report_issue(point, submissionId="old-recheck-round")["issue"]
        issue2 = api.review(issue2, "recheck", "remeasure")["issue"]
        registered = api.register_recheck(issue2)["issue"]
        resumed = api.ok_post(
            f"/issues/{registered['id']}/review",
            {
                "expectedRev": registered["rev"],
                "action": "to_repair",
                "category": "equipment",
                "note": "新一轮维修重新处理",
            },
            "new-repair-round",
        )["issue"]
        api.ok_post(
            f"/issues/{resumed['id']}/review",
            {
                "expectedRev": resumed["rev"],
                "action": "recheck",
                "category": "remeasure",
                "note": "重新改为复查状态",
            },
            "new-recheck-review",
        )
        current = next(i for i in api.get("/issues") if i["id"] == issue2["id"])
        response = api.fpost(
            f"/issues/{issue2['id']}/rechecks/outcome",
            {
                "expectedRev": current["rev"],
                "outcome": "recovered",
                "note": "沿用前轮复查关闭尚未验收的新工单问题",
            },
            "old-round",
        )
        data = record("old pending recheck reused after new repair review", response)
        if data:
            results[-1].update(
                {
                    "issueStatus": data["issue"]["status"],
                    "orderStatuses": [
                        o["status"] for o in api.get("/work-orders") if o["issueId"] == issue2["id"]
                    ],
                }
            )
        response = api.fpost(
            f"/inspection/tasks/{task['id']}/check-in",
            {
                "expectedRev": task["rev"],
                "pointId": point["id"],
                "method": "manual",
                "labelRead": "ANY",
                "fallbackReason": "标签损坏人工核查",
            },
            "arrive-manual",
            "demo-inspector",
        )
        # 使用另一个新计划，验证当天重复生成与独立测点的空答案提交。
        crack = ids["point"]
        api.create_plan(crack["id"], crack["buildingId"], crack["floorId"])
        response = api.fpost(
            "/inspection/tasks/generate", {"date": today()}, f"inspection_generate|{today()}"
        )
        record(
            "web day-wide generation key replays after adding another plan",
            response,
            replayed=response.json().get("replayed"),
            tasksBeforeFreshGeneration=len(api.get("/inspection/tasks")),
        )
        api.generate(key="generate-new-plan")
        ct = api.task_for_point(crack["id"])
        arrived = api.ok_post(
            f"/inspection/tasks/{ct['id']}/check-in",
            {
                "expectedRev": ct["rev"],
                "pointId": crack["id"],
                "method": "nfc",
                "labelRead": "NFC-CRACK-01",
            },
            "arrive-crack",
            "demo-inspector",
        )["task"]
        response = api.fpost(
            f"/inspection/tasks/{ct['id']}/complete-point",
            {
                "expectedRev": arrived["rev"],
                "pointId": crack["id"],
                "answers": [{"key": "wall", "result": ""}],
                "noIssueReason": "",
            },
            "bad-answer",
            "demo-inspector",
        )
        data = record("empty checklist answer accepted as completed", response)
        if data:
            results[-1]["status"] = data["task"]["status"]
        current_issue = api.report_issue(point, submissionId="no-photo-reason")["issue"]
        reason = "标签损坏无法现场拍照但已经完成现场处置"
        reviewed = api.review(current_issue, "close_no_fault", "handled", noPhotoReason=reason)[
            "issue"
        ]
        with engine.connect() as conn:
            rows = conn.execute(
                text("select * from issues where id=:id"), {"id": reviewed["id"]}
            ).fetchall()
            audits = conn.execute(
                text("select * from audits where object_id=:id"), {"id": reviewed["id"]}
            ).fetchall()
        results.append(
            {
                "case": "noPhotoReason not in issue or audit",
                "reasonPersisted": reason
                in json.dumps([list(r) for r in [*rows, *audits]], ensure_ascii=False),
            }
        )
        media = api.upload_photo(point["id"], key="repair-upload-acceptance", account="demo-repair")
        response = api.fpost(
            "/issues",
            {
                "source": "report",
                "pointId": point["id"],
                "buildingId": point["buildingId"],
                "anomalyType": "test",
                "description": "test",
                "submissionId": "repair-acceptance",
                "photos": [
                    {
                        "mediaId": media["id"],
                        "draftId": "repair-acceptance-photo",
                        "kind": "acceptance",
                    }
                ],
            },
            "repair-acceptance",
            "demo-repair",
        )
        record("repair role can attach acceptance photo through field issue command", response)
        reviewissue = api.report_issue(point, submissionId="link-closed-event")["issue"]
        response = api.fpost(
            f"/issues/{reviewissue['id']}/review",
            {
                "expectedRev": reviewissue["rev"],
                "action": "link_object",
                "category": "event",
                "linkedEventId": event["id"],
                "note": "四字说明",
            },
            "link-closed-short",
        )
        record("closed event link with only four character note", response)
    engine.dispose()
print("AUDIT_RESULT=" + json.dumps(results, ensure_ascii=True))
