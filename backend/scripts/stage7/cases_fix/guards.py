# ruff: noqa: E501
"""写保护与权限收回：幂等重放、冲突、旧 epoch 拒绝与会话逐轮脱敏。"""

import json

from stage7_checks import check

from .shared import reply_meta, set_scope


def write_guards(api, state: dict, add, ask) -> None:
    question = "B05-F2-CRACK01 现在怎么样"
    first = ask("q38", question)
    session_id = first["sessionId"]
    before = api.get(f"/assistant/sessions/{session_id}")
    replay = ask("q38", question)
    after = api.get(f"/assistant/sessions/{session_id}")
    conflict_status, conflict = reply_meta(api, "q38", "B06-F1-CRACK01 现在怎么样")
    point_id = state["ids"]["crack2"]["id"]
    frames_before = len(api.get(f"/media-sessions/frames?pointId={point_id}"))
    stale = api.http.post(
        api.path("/media-sessions/frames"),
        json={"mediaId": state["media"]["before"]["id"], "pointId": point_id},
        headers={**api.headers("demo-safety", "q38-stale"), "X-Dataset-Epoch": "999"},
    )
    frames_after = len(api.get(f"/media-sessions/frames?pointId={point_id}"))
    add(
        "q38",
        "同键同内容重放、同键异内容冲突、旧 epoch 写入拒绝",
        [
            check(
                "replay_turn",
                replay["turnId"] == first["turnId"],
                f"{first['turnId']} vs {replay['turnId']}",
            ),
            check(
                "replay_session",
                before["turnCount"] == after["turnCount"],
                f"{before['turnCount']} vs {after['turnCount']}",
            ),
            check("conflict_status", conflict_status == 409, str(conflict_status)),
            check(
                "conflict_code",
                conflict.get("error", {}).get("code") == "IDEMPOTENCY_CONFLICT",
                str(conflict),
            ),
            check("stale_status", stale.status_code == 409, str(stale.status_code)),
            check(
                "stale_code",
                stale.json().get("error", {}).get("code") == "DATASET_EPOCH_CONFLICT",
                stale.text[:120],
            ),
            check(
                "stale_no_write",
                frames_before == frames_after,
                f"{frames_before} vs {frames_after}",
            ),
        ],
        replay,
    )


def scope_revoked(api, state: dict, add, ask) -> None:
    crack_id = state["ids"]["crack"]["id"]
    answer = ask("q39", "B05-F2-CRACK01 现在怎么样", account="verify-scoped")
    session_id = answer["sessionId"]
    scoped = {"Authorization": f"Bearer {api.token('verify-scoped')}"}
    before = api.http.get(api.path(f"/assistant/sessions/{session_id}"), headers=scoped)
    set_scope(state["db"], [])
    after = api.http.get(api.path(f"/assistant/sessions/{session_id}"), headers=scoped)
    again = ask("q39b", "B05-F2-CRACK01 现在怎么样", account="verify-scoped")
    turn = next(row for row in after.json()["data"]["turns"] if row["id"] == answer["turnId"])
    before_turn = next(
        row for row in before.json()["data"]["turns"] if row["id"] == answer["turnId"]
    )
    add(
        "q39",
        "权限收回后旧会话不返回原业务内容",
        [
            check(
                "before_visible",
                before.status_code == 200 and before_turn["currentVisible"] is True,
                str(before.status_code),
            ),
            check("after_status", after.status_code == 200, str(after.status_code)),
            check(
                "after_redacted",
                turn["answer"]["historical"] is True,
                str(turn["answer"].get("historical")),
            ),
            check(
                "after_no_facts",
                turn["answer"]["facts"] == []
                and turn["answer"]["conclusion"].startswith("该轮引用"),
                turn["answer"]["conclusion"][:40],
            ),
            check(
                "after_no_content",
                crack_id not in json.dumps(turn, ensure_ascii=False),
            ),
            check(
                "again_not_found",
                again["answer"]["status"] == "not_found",
                again["answer"]["status"],
            ),
        ],
        again,
    )
    set_scope(state["db"], [state["ids"]["building"]["id"]])
