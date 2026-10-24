# ruff: noqa: E501, E402
"""阶段 7 重启/备份恢复核对：按 questions.json 的记录回读会话、影像与视频。"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import httpx

SCRIPTS = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from stage7_http_support import mp4


def _hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _session(payload: dict) -> dict:
    if payload.get("ok") is False:
        return {"status": 410, "error": payload.get("error", {}).get("code")}
    data = payload.get("data", payload)
    turns = data.get("turns") or []
    return {
        "status": 200,
        "epoch": data.get("epoch"),
        "turnCount": data.get("turnCount"),
        "firstQuestion": turns[0]["question"] if turns else "",
        "objects": turns[0]["answer"]["objects"] if turns else {},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:18002/api/v1/")
    parser.add_argument("--questions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    evidence = json.loads(args.questions.read_text(encoding="utf-8"))
    seeded = evidence["seeded"]
    cases = {row["id"]: row for row in evidence["cases"]}
    http = httpx.Client(base_url=args.url, timeout=60, trust_env=False)
    try:
        token = http.post("demo/identity", json={"identityId": "demo-safety"}).json()["data"][
            "accessToken"
        ]
        headers = {"Authorization": "Bearer " + token}
        prefix = "datasets/demo-main"
        stale = http.get(
            f"{prefix}/assistant/sessions/{cases['q41']['sessionId']}", headers=headers
        )
        current = http.get(
            f"{prefix}/assistant/sessions/{cases['q42']['sessionId']}", headers=headers
        )
        summary = http.get(
            f"{prefix}/media-sessions/summary",
            params={"pointId": seeded["ids"]["crack2"]["id"]},
            headers=headers,
        )
        video = http.get(f"{prefix}/media/{seeded['media']['videoMedia']}/content", headers=headers)
        payload = {
            "base": args.url,
            "staleSession": {
                "status": stale.status_code,
                "code": stale.json().get("error", {}).get("code")
                if stale.status_code != 200
                else "",
            },
            "currentSession": _session(current.json() if current.status_code == 200 else {}),
            "summary": summary.json()["data"] if summary.status_code == 200 else {},
            "videoMedia": {
                "id": seeded["media"]["videoMedia"],
                "status": video.status_code,
                "sha256": _hash(video.content) if video.status_code == 200 else "",
                "size": len(video.content),
            },
        }
        summary_data = payload["summary"]
        payload["checks"] = {
            "staleSessionStaysRejected": payload["staleSession"]["status"] == 410
            and payload["staleSession"]["code"] == "STALE_SESSION",
            "sessionRestored": payload["currentSession"]["status"] == 200
            and payload["currentSession"]["epoch"] == 2
            and payload["currentSession"]["turnCount"] >= 2
            and payload["currentSession"]["firstQuestion"]
            == evidence["answers"]["q42"]["question"],
            "videoBytesRestored": payload["videoMedia"]["status"] == 200
            and payload["videoMedia"]["sha256"] == _hash(mp4()),
            "videoAnalysis": any(row.get("analysis") for row in summary_data.get("videos", [])),
            "videoFrameOrigin": any(
                row.get("origin") == "demo_generated" and row.get("videoId")
                for row in summary_data.get("frames", [])
            ),
            "comparisonRestored": len(summary_data.get("comparisons", [])) == 1,
        }
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(payload["checks"], ensure_ascii=False))
        return 0 if all(payload["checks"].values()) else 1
    finally:
        http.close()


if __name__ == "__main__":
    sys.exit(main())
