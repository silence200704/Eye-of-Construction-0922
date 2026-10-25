"""Independent RR1-RR7 verification; temporary database, actual ASGI routes."""

import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory

SOURCE = Path(__file__).parents[1] / "stage7-rereview" / "probes.py"
spec = importlib.util.spec_from_file_location("previous_review", SOURCE)
previous = importlib.util.module_from_spec(spec)
spec.loader.exec_module(previous)

from field.fixtures import counts  # noqa: E402


def media_role_replay(api, ids):
    """Compare replay and current reads after loss of unbound-media access."""
    point_id = ids["point"]["id"]
    building_id = ids["building"]["id"]
    api.add_scoped_user("media-owner", [building_id], role="inspector")
    api.add_scoped_user("media-reader", [building_id], role="safety")
    media = api.upload_photo(account="media-owner", file_name="owner-private.png")
    body = {"pointId": point_id, "mediaId": media["id"], "label": "private-frame"}
    initial = api.fpost("/media-sessions/frames", body, "role-frame", "media-reader")
    assert initial.status_code == 200, initial.text
    engine = previous.create_engine(api.database_url)
    with engine.begin() as db:
        db.execute(previous.text("UPDATE users SET role='device' WHERE id='media-reader'"))
    engine.dispose()
    headers = {"Authorization": "Bearer " + api.token_for("media-reader")}
    fresh_read = api.client.get(previous.PREFIX + "/media-sessions/frames", headers=headers)
    fresh_write = api.fpost("/media-sessions/frames", body, "role-new", "media-reader")
    before = counts(api.database_url, "media_frames", "audits", "operation_receipts")
    replay = api.fpost("/media-sessions/frames", body, "role-frame", "media-reader")
    after = counts(api.database_url, "media_frames", "audits", "operation_receipts")
    return {
        "initial": previous.out(initial),
        "currentRead": previous.out(fresh_read),
        "currentNewCommand": previous.out(fresh_write),
        "replay": previous.out(replay),
        "countsBeforeReplay": before,
        "countsAfterReplay": after,
    }


def mixed_context_graph(api, ids, unbound):
    order = unbound["reviewed"]["order"]
    event = api.get("/events")[0]
    response = api.raw_ask(
        f"{order['orderNo']} 现在怎么样",
        context={"pointId": ids["point"]["id"], "eventId": event["id"]},
        key="order-with-unrelated-old-event",
    )
    return {
        "order": order,
        "actualIssue": unbound["seededIssue"],
        "unrelatedOldEvent": event["id"],
        "unrelatedOldPoint": ids["point"]["id"],
        "result": previous.out(response),
    }


def main():
    with TemporaryDirectory(prefix="zhutong-s7-final-review-") as folder:
        runtime = Path(folder)
        settings = previous.Settings(
            runtime_dir=runtime,
            database_url=f"sqlite:///{(runtime / 'review.sqlite').as_posix()}",
        )
        previous.initialize(settings)
        with previous.TestClient(previous.create_app(settings)) as client:
            api = previous.AssistantApi(client, str(settings.database_url))
            ids = api.seed_manual_point()
            api.add_record(ids["point"]["id"], 0.82, minutes=-15)
            unbound = previous.unbound_scope(api, ids)
            result = {
                "reviewedCode": "2579f1f",
                "reviewedDocs": "4080295",
                "method": "Temporary SQLite; actual ASGI routes, not TCP/browser",
                "revokedReplay": previous.replay_after_revoke(api, ids),
                "unboundScope": unbound,
                "mixedObjects": previous.mixed_objects(api, ids, unbound),
                "mixedContextGraph": mixed_context_graph(api, ids, unbound),
                "knowledgeFailure": previous.knowledge_failure(api),
                "overviewCount": previous.count_over_twenty(api, ids),
                "mediaRoleReplay": media_role_replay(api, ids),
            }
    target = Path(__file__).with_name("results.json")
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Independent probe results saved:", target)


if __name__ == "__main__":
    main()
