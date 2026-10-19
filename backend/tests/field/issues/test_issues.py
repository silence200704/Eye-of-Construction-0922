"""S5-03 / S5-04 / S5-05：上报幂等、六种审核出口与关联。"""

from fastapi.testclient import TestClient

from ..fixtures import FieldApi


def test_report_submission_key_is_idempotent_but_independent_reports_are_not_merged(
    client: TestClient, settings
) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    first = api.report_issue(ids["manual"], submissionId="submission-a")
    replay = api.fpost(
        "/issues",
        {
            "source": "report",
            "pointId": ids["manual"]["id"],
            "buildingId": ids["manual"]["buildingId"],
            "floorId": ids["manual"]["floorId"],
            "anomalyType": "墙面裂缝",
            "description": "现场发现新增裂缝",
            "submissionId": "submission-a",
            "photos": [],
        },
        "submission-a-different-action-key",
    )
    assert replay.status_code == 200
    assert replay.json()["data"]["duplicated"] is True
    assert replay.json()["data"]["issue"]["id"] == first["issue"]["id"]

    second = api.report_issue(ids["manual"], submissionId="submission-b")
    assert second["issue"]["id"] != first["issue"]["id"]
    assert len(api.get("/issues")) == 2


def test_six_review_exits_and_link_targets(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point = ids["manual"]

    repair = api.report_issue(point, submissionId="exit-repair")["issue"]
    repaired = api.review(repair, "to_repair", "equipment")
    assert repaired["issue"]["status"] == "repairing"
    assert repaired["order"]["status"] == "created"
    assert repaired["issue"]["workOrderIds"] == [repaired["order"]["id"]]

    evidence = api.report_issue(point, submissionId="exit-evidence")["issue"]
    assert api.review(evidence, "need_evidence", "image")["issue"]["status"] == "pending_review"

    investigate = api.report_issue(point, submissionId="exit-investigate")["issue"]
    assert api.review(investigate, "to_investigate", "crack")["issue"]["status"] == "investigating"

    recheck = api.report_issue(point, submissionId="exit-recheck")["issue"]
    assert api.review(recheck, "recheck", "remeasure")["issue"]["status"] == "pending_recheck"

    closed = api.report_issue(point, submissionId="exit-close")["issue"]
    assert api.review(closed, "close_no_fault", "no_fault")["issue"]["status"] == "closed"

    target = api.report_issue(point, submissionId="exit-target")["issue"]
    source = api.report_issue(point, submissionId="exit-source")["issue"]
    linked = api.review(
        source,
        "link_object",
        "issue",
        duplicateOf=target["id"],
        note="关联到已有问题并写明依据，避免重复处置",
    )
    assert linked["issue"]["status"] == "closed"
    assert linked["issue"]["duplicateOf"] == target["id"]
    refreshed = next(row for row in api.get("/issues") if row["id"] == target["id"])
    assert source["id"] in refreshed["linkedFrom"]

    bad_category = api.fpost(
        f"/issues/{target['id']}/review",
        {
            "expectedRev": refreshed["rev"],
            "action": "to_repair",
            "category": "not-a-category",
            "note": "审核意见：现场情况已核对",
        },
        "bad-category",
    )
    assert bad_category.status_code == 422

    short_note = api.fpost(
        f"/issues/{target['id']}/review",
        {
            "expectedRev": refreshed["rev"],
            "action": "need_evidence",
            "category": "image",
            "note": "短",
        },
        "short-note",
    )
    assert short_note.status_code == 422

    self_link = api.fpost(
        f"/issues/{target['id']}/review",
        {
            "expectedRev": refreshed["rev"],
            "action": "link_object",
            "category": "issue",
            "note": "关联到本问题自身，这是不允许的动作",
            "duplicateOf": target["id"],
        },
        "self-link",
    )
    assert self_link.status_code == 422


def test_sensor_issue_uses_event_source(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    event = api.get("/events")[0]
    issue = api.ok_post(
        "/issues",
        {
            "source": "sensor",
            "pointId": ids["point"]["id"],
            "buildingId": ids["building"]["id"],
            "floorId": ids["floor"]["id"],
            "zoneId": "",
            "anomalyType": "裂缝越限",
            "description": "预警事件转问题",
            "submissionId": "sensor-1",
            "eventId": event["id"],
        },
        "sensor-issue",
    )
    assert issue["issue"]["source"] == "sensor"
    assert issue["issue"]["eventId"] == event["id"]
    replay = api.fpost(
        "/issues",
        {
            "source": "sensor",
            "pointId": ids["point"]["id"],
            "buildingId": ids["building"]["id"],
            "floorId": ids["floor"]["id"],
            "anomalyType": "裂缝越限",
            "description": "预警事件转问题",
            "submissionId": "sensor-2",
            "eventId": event["id"],
        },
        "sensor-issue-2",
    )
    assert replay.json()["data"]["duplicated"] is True
    assert replay.json()["data"]["issue"]["id"] == issue["issue"]["id"]


def test_link_object_to_event_is_bidirectional(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.82, minutes=-30)
    event = api.get("/events")[0]
    issue = api.report_issue(ids["manual"], submissionId="link-event")["issue"]
    linked = api.review(
        issue,
        "link_object",
        "event",
        linkedEventId=event["id"],
        note="本次人工发现与预警事件为同一处异常，关联后保留两次记录",
    )
    assert linked["issue"]["status"] == "closed"
    assert linked["issue"]["linkedEventId"] == event["id"]
    refreshed = next(row for row in api.get("/events") if row["id"] == event["id"])
    details = [row["detail"] for row in refreshed["timeline"]]
    assert any(issue["issueNo"] in detail for detail in details)
