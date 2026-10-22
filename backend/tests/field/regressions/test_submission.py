"""上报标识只允许原提交补传，不能吞掉不同业务或越权重试。"""

from fastapi.testclient import TestClient

from ..fixtures import FieldApi


def test_submission_reuse_with_different_report_is_conflict(client: TestClient, settings):
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    first = api.report_issue(ids["manual"], submissionId="same-submission")["issue"]
    response = api.fpost(
        "/issues",
        {
            "pointId": ids["point"]["id"],
            "buildingId": ids["building"]["id"],
            "description": "另一次独立上报",
            "anomalyType": "设备松动",
            "submissionId": "same-submission",
        },
        "different-report",
    )
    assert response.status_code == 409
    assert api.get("/issues") == [first]


def test_submission_reuse_checks_target_scope_without_photos(client: TestClient, settings):
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point = ids["manual"]
    api.report_issue(point, submissionId="scoped-submission")
    token = api.add_scoped_user("no-buildings", [])
    response = client.post(
        "/api/v1/datasets/demo-main/issues",
        headers={
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": "scope-replay",
            "X-Dataset-Epoch": str(api.epoch),
        },
        json={
            "pointId": point["id"],
            "buildingId": point["buildingId"],
            "description": "现场发现新增裂缝",
            "anomalyType": "墙面裂缝",
            "submissionId": "scoped-submission",
        },
    )
    assert response.status_code == 403


def test_submission_cannot_be_reused_by_another_identity(client: TestClient, settings):
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point = ids["manual"]
    api.report_issue(point, submissionId="identity-submission")
    response = api.fpost(
        "/issues",
        {
            "pointId": point["id"],
            "buildingId": point["buildingId"],
            "description": "现场发现新增裂缝",
            "anomalyType": "墙面裂缝",
            "submissionId": "identity-submission",
        },
        "other-actor",
        "demo-repair",
    )
    assert response.status_code == 403
