# ruff: noqa: E501
"""视频持久化、历史快照与数据集 epoch 变化后的会话边界。"""

from stage7_checks import check, fact
from stage7_http_support import mp4, stamp

from .shared import bump_epoch, latest_value


def video_chain(api, state: dict, add, ask) -> None:
    point_id = state["ids"]["crack2"]["id"]
    summary = api.get(f"/media-sessions/summary?pointId={point_id}")
    video = state["video"]["video"]
    media = state["video"]["media"]
    content = api.content(media["id"])
    frames = [row for row in summary["frames"] if row.get("videoId") == video["id"]]
    add(
        "q40",
        "视频原字节、元数据、关键帧与分析结果持久化",
        [
            check(
                "video_rows",
                [row["id"] for row in summary.get("videos", [])] == [video["id"]],
                str(summary.get("videos")),
            ),
            check(
                "video_analysis",
                summary["videos"][0]["analysis"]["frameIds"] == [state["video"]["frame"]["id"]],
                str(summary["videos"][0]["analysis"].get("frameIds")),
            ),
            check(
                "frame_video",
                len(frames) == 1 and frames[0]["timeCode"] == 3.0,
                str(frames),
            ),
            check("frame_origin", frames[0]["origin"] == "demo_generated", frames[0]["origin"]),
            check(
                "content_bytes",
                content.status_code == 200 and content.content == mp4(),
                str(content.status_code),
            ),
            check(
                "video_source",
                video["metadata"]["source"] == "随包演示素材",
                str(video["metadata"].get("source")),
            ),
        ],
        {
            "sessionId": "",
            "turnId": "",
            "answer": {"intent": "media_video", "sources": {"facts": "server_db"}},
        },
    )


def history_case(api, state: dict, add, ask) -> None:
    crack2_id = state["ids"]["crack2"]["id"]
    first = ask("q41", "B05-F2-CRACK02 现在怎么样")
    value = latest_value(api, crack2_id)
    api.post(
        "/records",
        {
            "pointId": crack2_id,
            "values": {"width": 0.99},
            "unit": "mm",
            "sampleTime": stamp(0),
            "source": "manual",
            "quality": "valid",
            "note": "历史快照核对记录",
        },
        "q41-record",
    )
    again = ask("q41b", "B05-F2-CRACK02 现在怎么样")
    detail = api.get(f"/assistant/sessions/{first['sessionId']}")
    old = next(row for row in detail["turns"] if row["id"] == first["turnId"])
    old_value = fact(old["answer"], "当前读数")
    add(
        "q41",
        "业务变更后旧回答保留查询时刻，重问读当前值",
        [
            check("old_value", old_value == value, f"{old_value} vs {value}"),
            check(
                "new_value",
                fact(again["answer"], "当前读数") == "0.99",
                fact(again["answer"], "当前读数"),
            ),
            check(
                "old_snapshot",
                old["answer"]["snapshot"]["queriedAt"] == old["answer"]["sources"]["queriedAt"],
                str(old["answer"]["snapshot"].get("queriedAt")),
            ),
            check(
                "snapshot_revision",
                all(
                    "recordRevision" in row for row in old["answer"]["snapshot"].get("records", [])
                ),
                str(old["answer"]["snapshot"].get("records")),
            ),
        ],
        again,
    )


def epoch_case(api, state: dict, add, ask) -> None:
    old_session = ask("q42a", "B05-F2-CRACK01 现在怎么样")["sessionId"]
    bump_epoch(state["db"])
    api.epoch = 2
    stale = api.http.get(
        api.path(f"/assistant/sessions/{old_session}"),
        headers={"Authorization": f"Bearer {api.token('demo-safety')}"},
    )
    fresh = ask("q42", "现在有哪些未处理预警")
    follow = ask("q42b", "B05-F2-CRACK02 现在怎么样")
    restored = api.get(f"/assistant/sessions/{fresh['sessionId']}")
    add(
        "q42",
        "数据集 epoch 变化后旧会话拒绝恢复，新提问按新 epoch 建立",
        [
            check("stale_session", stale.status_code == 410, str(stale.status_code)),
            check(
                "stale_code",
                stale.json().get("error", {}).get("code") == "STALE_SESSION",
                stale.text[:120],
            ),
            check(
                "fresh_answered",
                fresh["answer"]["status"] in ("answered", "not_found"),
                fresh["answer"]["status"],
            ),
            check(
                "fresh_session",
                restored["epoch"] == 2 and restored["turnCount"] == 2,
                f"epoch={restored['epoch']} turns={restored['turnCount']}",
            ),
            check(
                "follow_answered",
                follow["answer"]["status"] == "answered",
                follow["answer"]["status"],
            ),
        ],
        follow,
    )
