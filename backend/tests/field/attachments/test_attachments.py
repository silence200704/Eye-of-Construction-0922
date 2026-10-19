"""S5-09：照片真实字节、所有权、唯一归属、配额与补关联重试。"""

import hashlib

from fastapi.testclient import TestClient

from ..fixtures import PNG, FieldApi, counts, noise_png


def issue_body(point: dict, submission: str, photos: list[dict]) -> dict:
    return {
        "source": "report",
        "pointId": point["id"],
        "buildingId": point["buildingId"],
        "floorId": point["floorId"],
        "zoneId": point["zoneId"],
        "anomalyType": "墙面裂缝",
        "description": "现场发现新增裂缝",
        "submissionId": submission,
        "photos": photos,
    }


def photo_spec(media: dict, draft: str) -> dict:
    return {"mediaId": media["id"], "draftId": draft, "kind": "scene"}


def test_photo_bytes_idempotent_draft_and_single_owner(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    media = api.upload_photo(ids["manual"]["id"], key="att-photo-1")
    body = issue_body(ids["manual"], "att-real", [photo_spec(media, "draft-a")])
    created = api.ok_post("/issues", body, "issue-att-real")
    attachment = next(
        row for row in api.get("/attachments") if row["issueId"] == created["issue"]["id"]
    )
    assert attachment["mediaId"] == media["id"]
    assert attachment["sha256"] == hashlib.sha256(PNG).hexdigest()
    assert attachment["size"] == len(PNG)
    assert attachment["issueId"] == created["issue"]["id"]
    content = api.client.get(attachment["contentUrl"], headers=api.auth())
    assert content.status_code == 200
    assert content.content == PNG

    before = counts(
        str(settings.database_url), "issues", "attachments", "audits", "operation_receipts"
    )
    replay = api.fpost("/issues", body, "issue-att-real")
    assert replay.status_code == 200
    assert replay.json()["replayed"] is True
    assert replay.json()["data"]["issue"]["id"] == created["issue"]["id"]
    assert counts(str(settings.database_url), *before) == before

    extra = api.upload_photo(ids["manual"]["id"], key="att-photo-backfill")
    backfill = api.fpost(
        "/issues",
        issue_body(ids["manual"], "att-real", [photo_spec(extra, "draft-backfill")]),
        "issue-att-backfill",
    )
    assert backfill.status_code == 200
    assert backfill.json()["data"]["duplicated"] is True
    assert len(backfill.json()["data"]["issue"]["photos"]) == 2
    assert len(api.get("/attachments")) == 2


def test_photo_ownership_draft_and_single_owner(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    other = api.ok(
        api.post(
            "/points",
            {
                "code": "B03-F2-CHECK02",
                "name": "第二人工检查点",
                "buildingId": ids["building"]["id"],
                "floorId": ids["floor"]["id"],
                "type": "manual_check",
                "coord": {"x": 0.6, "y": 0.6},
            },
            key="manual-point-second",
        )
    )
    media = api.upload_photo(ids["manual"]["id"], key="att-photo-owner")
    api.ok_post(
        "/issues",
        issue_body(ids["manual"], "att-owner-base", [photo_spec(media, "draft-a")]),
        "issue-att-owner-base",
    )
    denied = api.fpost(
        "/issues",
        issue_body(
            other,
            "att-owner-denied",
            [
                photo_spec(
                    api.upload_photo(other["id"], key="att-photo-denied"), "draft-owner-denied"
                )
            ],
        ),
        "issue-att-owner",
        "demo-inspector",
    )
    assert denied.status_code == 403

    wrong_point = api.upload_photo(other["id"], key="att-photo-other")
    mismatch = api.fpost(
        "/issues",
        issue_body(ids["manual"], "att-point", [photo_spec(wrong_point, "draft-point")]),
        "issue-att-point",
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "STATE_CONFLICT"

    second_media = api.upload_photo(ids["manual"]["id"], key="att-photo-2")
    conflict = api.fpost(
        "/issues",
        issue_body(ids["manual"], "att-draft", [photo_spec(second_media, "draft-a")]),
        "issue-att-draft",
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"

    reused = api.fpost(
        "/issues",
        issue_body(ids["manual"], "att-reuse", [photo_spec(media, "draft-new")]),
        "issue-att-reuse",
    )
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "STATE_CONFLICT"


def test_attachment_quota_is_three_and_600kb(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point = ids["manual"]
    photos = [
        api.upload_photo(point["id"], key=f"quota-{index}", file_name=f"q{index}.png")
        for index in range(4)
    ]
    specs = [photo_spec(media, f"quota-draft-{index}") for index, media in enumerate(photos)]
    before = counts(
        str(settings.database_url), "issues", "attachments", "audits", "operation_receipts"
    )
    rejected = api.fpost("/issues", issue_body(point, "quota-four", specs), "issue-quota-four")
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "ATTACHMENT_LIMIT"
    assert counts(str(settings.database_url), *before) == before
    assert api.get("/issues") == []

    accepted = api.ok_post(
        "/issues", issue_body(point, "quota-three", specs[:3]), "issue-quota-three"
    )
    issue = accepted["issue"]
    attached = [row for row in api.get("/attachments") if row["issueId"] == issue["id"]]
    assert len(attached) == 3
    assert {row["issueId"] for row in attached} == {issue["id"]}
    rejected_review = api.fpost(
        f"/issues/{issue['id']}/review",
        {
            "expectedRev": issue["rev"],
            "action": "need_evidence",
            "category": "other",
            "note": "需要补充照片证据",
            "photos": [specs[3]],
        },
        "review-quota-fourth",
    )
    assert rejected_review.status_code == 422
    assert rejected_review.json()["error"]["code"] == "ATTACHMENT_LIMIT"
    current = next(row for row in api.get("/issues") if row["id"] == issue["id"])
    assert current["status"] == "pending_review"
    assert current["rev"] == issue["rev"]
    assert len(api.get("/attachments")) == 3

    big = api.upload_photo(point["id"], data=noise_png(), key="quota-big", file_name="big.png")
    assert big["size"] > 600 * 1024
    too_big = api.fpost(
        "/issues",
        issue_body(point, "quota-big", [photo_spec(big, "quota-big-draft")]),
        "issue-quota-big",
    )
    assert too_big.status_code == 422
    assert too_big.json()["error"]["code"] == "ATTACHMENT_LIMIT"
    assert len(api.get("/issues")) == 1
