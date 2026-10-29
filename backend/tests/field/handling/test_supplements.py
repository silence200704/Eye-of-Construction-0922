import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from zhutong.db.models import User

from ..fixtures import FieldApi, counts
from .fixtures import returned_issue


def test_supplement_appends_without_replacing_original_and_replays_without_writes(client, settings):
    api = FieldApi(client, str(settings.database_url))
    issue = returned_issue(api)
    path = f"/issues/{issue['id']}/supplements"
    body = {
        "expectedRev": issue["rev"],
        "note": "补充现场位置及观察记录，原描述应保留不覆盖",
        "photos": [],
    }
    result = api.fpost(path, body, "supplement-stable", "demo-inspector")
    assert result.status_code == 200, result.text
    row = result.json()["data"]["issue"]
    assert row["description"] == issue["description"] and row["id"] == issue["id"]
    assert row["reviewAction"] is None and row["status"] == "pending_review"
    assert (
        row["timeline"][:-1] == issue["timeline"] and body["note"] in row["timeline"][-1]["detail"]
    )
    before = counts(str(settings.database_url), "issues", "audits", "operation_receipts")
    retry = api.fpost(path, body, "supplement-stable", "demo-inspector")
    assert retry.status_code == 200 and retry.json()["replayed"] is True
    assert counts(str(settings.database_url), "issues", "audits", "operation_receipts") == before
    fresh = api.fpost(
        path,
        {"expectedRev": row["rev"], "note": body["note"], "photos": []},
        "not-returned",
        "demo-inspector",
    )
    assert fresh.status_code == 409


@pytest.mark.parametrize("account", ["demo-safety", "demo-property", "demo-repair"])
def test_only_original_identity_can_supplement_even_with_same_name(client, settings, account):
    api = FieldApi(client, str(settings.database_url))
    issue = returned_issue(api)
    engine = create_engine(str(settings.database_url))
    with Session(engine) as db, db.begin():
        db.get(User, account).name = db.get(User, "demo-inspector").name
    engine.dispose()
    response = api.fpost(
        f"/issues/{issue['id']}/supplements",
        {"expectedRev": issue["rev"], "note": "尝试替别人提交补充材料，不应成功", "photos": []},
        "not-owner",
        account,
    )
    assert response.status_code == 403


def test_supplement_images_are_linked_to_same_issue_and_image_request_requires_new_photo(
    client, settings
):
    api = FieldApi(client, str(settings.database_url))
    issue = returned_issue(api, "image")
    path = f"/issues/{issue['id']}/supplements"
    body = {"expectedRev": issue["rev"], "note": "补充另一角度的现场照片，原照片保留", "photos": []}
    assert api.fpost(path, body, "missing-image", "demo-inspector").status_code == 422
    media = api.upload_photo(issue["pointId"], "supplement-image", account="demo-inspector")
    body["photos"] = [{"mediaId": media["id"], "draftId": "supplement-image", "kind": "scene"}]
    row = api.ok_post(path, body, "with-image", "demo-inspector")["issue"]
    assert len(row["photos"]) == 1 and row["description"] == issue["description"]
    context = client.get(
        f"/api/v1/datasets/demo-main/issues/{issue['id']}/supplement-context",
        headers={"Authorization": f"Bearer {api.token_for('demo-inspector')}"},
    )
    assert context.status_code == 200
    assert context.json()["data"]["existingPhotoCount"] == 1


def test_supplement_conflict_and_current_scope_guard_replay(client, settings):
    api = FieldApi(client, str(settings.database_url))
    issue = returned_issue(api)
    path = f"/issues/{issue['id']}/supplements"
    body = {
        "expectedRev": issue["rev"] - 1,
        "note": "补充现场核对记录，版本不可静默覆盖",
        "photos": [],
    }
    assert api.fpost(path, body, "stale", "demo-inspector").status_code == 409
    body["expectedRev"] = issue["rev"]
    api.ok_post(path, body, "valid", "demo-inspector")
    before = counts(str(settings.database_url), "issues", "audits", "operation_receipts")
    engine = create_engine(str(settings.database_url))
    with Session(engine) as db, db.begin():
        db.get(User, "demo-inspector").building_ids_json = "[]"
    engine.dispose()
    assert api.fpost(path, body, "valid", "demo-inspector").status_code == 403
    assert counts(str(settings.database_url), "issues", "audits", "operation_receipts") == before


def test_issue_list_exposes_stable_original_actor_for_supplement_affordance(client, settings):
    api = FieldApi(client, str(settings.database_url))
    issue = returned_issue(api)
    row = next(item for item in api.get("/issues") if item["id"] == issue["id"])
    assert row["createdById"] == "demo-inspector"
