# ruff: noqa: E501
"""阶段 7 逐题验收入口：固定前置数据 → 30 题 → 数据库快照。"""

import argparse
import json
import sys
from pathlib import Path

from stage7_cases import CaseInput, run
from stage7_http_support import (
    Api,
    seed_archive,
    seed_records,
    snapshot,
)
from stage7_seeds import (
    add_scoped_user,
    seed_field,
    seed_knowledge,
    seed_media,
    seed_second_issue,
    seed_video,
)

OUT = (
    Path(__file__).resolve().parents[2]
    / "docs/implementation/evidence/stage7-assistant/verification/questions.json"
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:18002/api/v1/")
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    api = Api(args.url)
    try:
        ids = seed_archive(api)
        add_scoped_user(args.db, "verify-scoped", [ids["building"]["id"]])
        events = seed_records(api, ids)
        event = next(row for row in events.values() if row["pointId"] == ids["crack"]["id"])
        field = seed_field(api, ids, event)
        docs = seed_knowledge(api)
        media = seed_media(api, ids["crack2"]["id"])
        second = seed_second_issue(api, ids["crack"])
        video = seed_video(api, ids["crack2"]["id"])
        result = run(
            CaseInput(
                api=api,
                ids=ids,
                events=events,
                field=field,
                media=media,
                docs=docs,
                db=args.db,
                second_issue=second,
                video=video,
            )
        )
        result["seeded"] = {
            "ids": ids,
            "event": event,
            "issue": field["issue"],
            "order": field["order"],
            "closedIssue": field["closedIssue"],
            "knowledge": [docs["first"]["id"], docs["second"]["id"]],
            "media": {
                "frames": [media["frame"]["id"], media["secondFrame"]["id"]],
                "comparison": media["comparison"]["id"],
                "video": video["video"]["id"],
                "videoMedia": video["media"]["id"],
            },
            "secondIssue": second,
        }
        result["database"] = snapshot(api)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {key: result[key] for key in ("total", "passed", "failed")}, ensure_ascii=False
            )
        )
        return 0 if result["failed"] == [] else 1
    finally:
        api.close()


if __name__ == "__main__":
    sys.exit(main())
