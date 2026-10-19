"""R5-07：照片动作身份、无照片原因与关闭对象例外依据。"""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from ..fixtures import FieldApi


def _issue_body(point: dict, submission: str, photos: list[dict]) -> dict:
    return {
        "source": "report",
        "pointId": point["id"],
        "buildingId": point["buildingId"],
        "floorId": point["floorId"],
        "anomalyType": "现场异常",
        "description": "照片动作校验",
        "submissionId": submission,
        "photos": photos,
    }


def test_repair_cannot_submit_acceptance_photo(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    photo = api.upload_photo(ids["manual"]["id"], key="repair-acceptance", account="demo-repair")
    response = api.fpost(
        "/issues",
        _issue_body(
            ids["manual"],
            "repair-acceptance",
            [{"mediaId": photo["id"], "draftId": "repair-acceptance-draft", "kind": "acceptance"}],
        ),
        "repair-acceptance-command",
        "demo-repair",
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ROLE_FORBIDDEN"
    assert api.get("/issues") == []


def test_no_photo_reason_is_persisted(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    issue = api.report_issue(ids["manual"], submissionId="no-photo-reason")["issue"]
    reason = "标签损坏无法现场拍照但已完成现场处置"
    reviewed = api.review(issue, "close_no_fault", "handled", noPhotoReason=reason)["issue"]
    current = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    assert reviewed["status"] == "closed"
    assert any(reason in str(row.get("detail", "")) for row in current["timeline"])
    engine = create_engine(str(settings.database_url))
    with engine.connect() as connection:
        audit = connection.execute(
            text("select reason from audits where object_id=:id"), {"id": issue["id"]}
        ).fetchall()
    engine.dispose()
    assert any(reason in str(row[0]) for row in audit)


def test_closed_event_link_requires_specific_basis(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-40)
    event = api.get("/events")[0]
    engine = create_engine(str(settings.database_url))
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE events SET status='closed' WHERE id=:id"), {"id": event["id"]}
        )
    engine.dispose()
    issue = api.report_issue(ids["point"], submissionId="closed-event-link")["issue"]
    short = api.fpost(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": issue["rev"],
            "action": "link_object",
            "category": "event",
            "linkedEventId": event["id"],
            "note": "四字说明",
        },
        "closed-event-link-short",
    )
    assert short.status_code == 422
    allowed = api.fpost(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": issue["rev"],
            "action": "link_object",
            "category": "event",
            "linkedEventId": event["id"],
            "note": "本次人工发现与预警事件为同一处异常，关联后保留两次记录",
        },
        "closed-event-link-long",
    )
    assert allowed.status_code == 200
