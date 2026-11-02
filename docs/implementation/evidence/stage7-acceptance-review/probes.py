"""Independent ASGI acceptance of the three repairs; no delivery data writes."""

import importlib.util
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[4]
source = ROOT / "docs/implementation/evidence/stage7-final-review/probes.py"
spec = importlib.util.spec_from_file_location("final_review_probes", source)
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)
previous = review.previous
sys.path.insert(0, str(ROOT / "backend/scripts/stage7"))

from field.fixtures import PNG, counts  # noqa: E402
from media.test_video_session import mp4  # noqa: E402
from stage7_seeds import seed_video  # noqa: E402


def upload_bound_video(api, account, point_id):
    response = api.client.post(
        previous.PREFIX + "/media",
        params={"fileName": "bound-video.mp4", "pointId": point_id},
        content=mp4(),
        headers={
            "Authorization": "Bearer " + api.token_for(account),
            "Idempotency-Key": "acceptance-owner-video",
            "Content-Type": "video/mp4",
        },
    )
    assert response.status_code in {200, 201}, response.text
    return response.json()["data"]


def register(api, operation, account):
    response = api.fpost(operation["path"], operation["body"], operation["key"], account)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def media_operations(api, ids, reader, owner):
    point = ids["point"]["id"]
    video_media = upload_bound_video(api, owner, point)
    video_op = {
        "path": "/media-sessions/videos",
        "key": "acceptance-video",
        "body": {"mediaId": video_media["id"], "pointId": point, "metadata": {}},
    }
    video = register(api, video_op, reader)
    operations, frames = [video_op], []
    for index, uploader in enumerate([reader, owner]):
        media = api.upload_photo(account=uploader, key=f"acceptance-photo-{index}")
        frame_op = {
            "path": "/media-sessions/frames",
            "key": f"acceptance-frame-{index}",
            "body": {"mediaId": media["id"], "pointId": point, "videoId": video["id"]},
        }
        frames.append(register(api, frame_op, reader))
        operations.append(frame_op)
    comparison = {
        "path": "/media-sessions/comparisons",
        "key": "acceptance-compare",
        "body": {
            "pointId": point,
            "beforeId": frames[0]["id"],
            "afterId": frames[1]["id"],
            "result": {},
        },
    }
    analysis = {
        "path": f"/media-sessions/videos/{video['id']}/analysis",
        "key": "acceptance-analysis",
        "body": {
            "analysis": {
                "videoId": video["id"],
                "pointId": point,
                "frameIds": [row["id"] for row in frames],
                "regions": {},
            }
        },
    }
    for operation in [comparison, analysis]:
        register(api, operation, reader)
        operations.append(operation)
    return operations


def ownership_branches(api, ids):
    building = ids["building"]["id"]
    reader, owner = "branch-reader", "branch-owner"
    api.add_scoped_user(reader, [building], role="safety")
    api.add_scoped_user(owner, [building], role="inspector")
    operations = media_operations(api, ids, reader, owner)
    tables = ["media_frames", "media_videos", "media_comparisons", "audits", "operation_receipts"]
    before = counts(api.database_url, *tables)
    allowed = [api.fpost(op["path"], op["body"], op["key"], reader) for op in operations]
    assert all(row.status_code == 200 and row.json()["replayed"] for row in allowed)
    assert counts(api.database_url, *tables) == before
    engine = previous.create_engine(api.database_url)
    with engine.begin() as db:
        db.execute(previous.text("UPDATE users SET role='device' WHERE id=:id"), {"id": reader})
    engine.dispose()
    narrowed = [api.fpost(op["path"], op["body"], op["key"], reader) for op in operations]
    statuses = [row.status_code for row in narrowed]
    # Bound videos remain readable with the same building scope, regardless of uploader.
    assert statuses == [200, 200, 403, 403, 200], statuses
    with engine.begin() as db:
        db.execute(
            previous.text("UPDATE users SET building_ids_json='[]' WHERE id=:id"), {"id": reader}
        )
    engine.dispose()
    revoked = [api.fpost(op["path"], op["body"], op["key"], reader) for op in operations]
    assert [row.status_code for row in revoked] == [404] * len(operations)
    assert counts(api.database_url, *tables) == before
    return {
        "operations": [op["key"] for op in operations],
        "authorizedReplayStatuses": [row.status_code for row in allowed],
        "narrowedReplayStatuses": statuses,
        "scopeRevokedStatuses": [row.status_code for row in revoked],
        "countsBefore": before,
        "countsAfter": counts(api.database_url, *tables),
    }


class SeedAdapter:
    """Run the actual seed script against the same temporary ASGI application."""

    def __init__(self, api):
        self.api = api

    def post(self, path, body, key):
        return self.api.ok_post(path, body, key)

    def upload(self, point_id, key, **options):
        response = self.api.client.post(
            previous.PREFIX + "/media",
            params={
                "pointId": point_id,
                "fileName": options.get("filename", "frame.png"),
                "origin": options.get("origin", "upload"),
            },
            content=options.get("data", PNG),
            headers={**self.api.headers(key=key), "Content-Type": options.get("mime", "image/png")},
        )
        assert response.status_code in {200, 201}, response.text
        return response.json()["data"]


def verify_seeds(api, ids):
    result = seed_video(SeedAdapter(api), ids["manual"]["id"])
    frames = result["frames"]
    assert [row["timeCode"] for row in frames] == [3.0, 6.0, 9.0]
    videos = api.get("/media-sessions/videos")
    video = next(row for row in videos if row["id"] == result["video"]["id"])
    analysis = video["analysis"]
    assert analysis["frameIds"] == [row["id"] for row in frames]
    assert analysis["videoId"] == video["id"]
    assert analysis["regions"]["crack"]["beforeId"] == frames[0]["id"]
    assert analysis["regions"]["crack"]["afterId"] == frames[2]["id"]
    assert analysis["regions"]["crack"]["changedRatio"] == 0.12
    return {
        "frameTimes": [row["timeCode"] for row in frames],
        "video": video,
        "minimalMp4": "Container storage only, not browser decode evidence",
    }


def verify_objects(api, ids):
    unbound = previous.unbound_scope(api, ids)
    result = review.mixed_context_graph(api, ids, unbound)
    answer = result["result"]["response"]["data"]["answer"]
    assert answer["objects"]["pointId"] is None
    assert answer["objects"]["eventId"] is None
    assert set(answer["snapshot"]["objects"]) == {"issueId", "workOrderId"}
    issue, order = unbound["seededIssue"], unbound["reviewed"]["order"]
    for label, question, context in [
        (
            "explicitIssue",
            f"{issue['issueNo']} 现在怎么样",
            {"pointId": ids["point"]["id"], "eventId": result["unrelatedOldEvent"]},
        ),
        (
            "ordinaryFollowup",
            "这张工单验收了吗",
            {"issueId": issue["id"], "workOrderId": order["id"]},
        ),
    ]:
        reply = api.ask(question, context=context, key=label)["answer"]
        assert reply["status"] == "answered", reply
        assert reply["objects"]["issueId"] == issue["id"]
        assert reply["objects"]["pointId"] is None
        assert reply["objects"]["eventId"] is None
        result[label] = reply
    return result


def main():
    with TemporaryDirectory(prefix="zhutong-s7-acceptance-") as folder:
        runtime = Path(folder)
        settings = previous.Settings(
            runtime_dir=runtime, database_url=f"sqlite:///{(runtime / 'accept.sqlite').as_posix()}"
        )
        previous.initialize(settings)
        with previous.TestClient(previous.create_app(settings)) as client:
            api = previous.AssistantApi(client, str(settings.database_url))
            ids = api.seed_manual_point()
            api.add_record(ids["point"]["id"], 0.82, minutes=-15)
            media = review.media_role_replay(api, ids)
            assert media["currentRead"]["response"]["data"] == []
            assert media["currentNewCommand"]["status"] == media["replay"]["status"] == 403
            assert media["countsBeforeReplay"] == media["countsAfterReplay"]
            result = {
                "code": "9d1cb8f",
                "docs": "e8b40b9",
                "method": "Temporary SQLite, ASGI",
                "mediaReplay": media,
                "ownershipBranches": ownership_branches(api, ids),
                "objectGraph": verify_objects(api, ids),
                "seedVideo": verify_seeds(api, ids),
            }
    Path(__file__).with_name("results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print("All independent repair probes passed; results.json saved")


if __name__ == "__main__":
    main()
