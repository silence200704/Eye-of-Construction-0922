# ruff: noqa: E501
"""阶段 7 逐题验收：固定数据库前置 + 真实 HTTP + 数据库快照。

运行前启动独立临时 API（18002）并初始化空的阶段 7 库。
脚本只写临时库；每题保存回答、对象 ID、关键事实与引用核验。
"""

from dataclasses import dataclass, field
from pathlib import Path

from cases_fix import run_fix
from stage7_cases_late import run_late
from stage7_http_support import Api


def fact(answer: dict, label: str) -> str:
    return next((row["value"] for row in answer["facts"] if row["label"] == label), "")


def citation_valid(api: Api, row: dict) -> bool:
    try:
        doc = api.get(f"/knowledge/documents/{row['documentId']}")
    except AssertionError:
        return False
    chunk = next((item for item in doc["chunks"] if item["id"] == row["chunkId"]), None)
    if chunk is None or doc["version"] != row["version"] or not doc["enabled"]:
        return False
    lines = doc["content"].splitlines()
    excerpt = "\n".join(lines[row["lineStart"] - 1 : row["lineEnd"]]).strip()
    return chunk["text"] in excerpt and chunk["sha256"] == row["sha256"]


def check(name: str, ok: bool, detail: str = "") -> dict:
    return {"check": name, "passed": bool(ok), "detail": detail}


def basic(answer: dict, intent: str, status: str = "answered") -> list[dict]:
    return [
        check("intent", answer.get("intent") == intent, str(answer.get("intent"))),
        check("status", answer.get("status") == status, str(answer.get("status"))),
        check(
            "source_facts",
            answer["sources"]["facts"] == ("server_db" if status == "answered" else "none"),
            answer["sources"]["facts"],
        ),
    ]


def point_checks(answer: dict, point_id: str, value: str | None = None) -> list[dict]:
    checks = [
        check(
            "object_point",
            answer["objects"]["pointId"] == point_id,
            str(answer["objects"]["pointId"]),
        ),
        check("fact_point_label", bool(fact(answer, "测点")), fact(answer, "测点")),
    ]
    if value is not None:
        checks.append(
            check("fact_current", fact(answer, "当前读数") == value, fact(answer, "当前读数"))
        )
    return checks


@dataclass(frozen=True)
class CaseInput:
    api: Api
    ids: dict
    events: dict
    field: dict
    media: dict
    docs: dict
    db: Path
    second_issue: dict = field(default_factory=dict)
    video: dict = field(default_factory=dict)


@dataclass
class CaseRun:
    input: CaseInput
    answers: dict = field(default_factory=dict)
    cases: list = field(default_factory=list)

    def ask(self, case_id: str, question: str, context: dict | None = None, **options) -> dict:
        reply = self.input.api.ask(
            question,
            context,
            key=options.get("key") or case_id,
            account=options.get("account", "demo-safety"),
        )
        self.answers[case_id] = {"question": question, "context": context or {}, "reply": reply}
        return reply

    def add(self, case_id: str, question: str, checks: list[dict], reply: dict) -> None:
        self.cases.append(
            {
                "id": case_id,
                "question": question,
                "sessionId": reply["sessionId"],
                "turnId": reply["turnId"],
                "answer": reply["answer"],
                "checks": checks,
                "passed": all(row["passed"] for row in checks),
            }
        )

    def result(self) -> dict:
        return {
            "total": len(self.cases),
            "passed": sum(row["passed"] for row in self.cases),
            "failed": [row["id"] for row in self.cases if not row["passed"]],
            "cases": self.cases,
            "answers": {
                key: value["reply"]["answer"]
                for key, value in self.answers.items()
                if isinstance(value, dict) and "reply" in value
            },
        }


def _state(api: Api, run: CaseRun) -> dict:
    ids = run.input.ids
    crack_id = ids["crack"]["id"]
    event = next(row for row in run.input.events.values() if row["pointId"] == crack_id)
    return {
        "ids": ids,
        "event": event,
        "event_no": event["eventNo"],
        "issue": run.input.field["issue"],
        "order": run.input.field["order"],
        "closed": next(
            row for row in api.get("/issues") if row["id"] == run.input.field["closedIssue"]["id"]
        ),
        "media": run.input.media,
        "first": run.answers["q01"]["reply"],
        "second_issue": run.input.second_issue,
        "video": run.input.video,
        "db": run.input.db,
    }


def run(input: CaseInput) -> dict:
    run = CaseRun(input)
    api = input.api
    crack_id, crack2_id, event, event_no, issue, order = _objects(run)
    _point_cases(run, crack_id, crack2_id)
    _event_cases(run, event, event_no)
    _issue_cases(run, issue, order)
    state = _state(api, run)
    run_late(api, state, run.add, run.ask)
    run_fix(api, state, run.add, run.ask)
    return run.result()


def _objects(run: CaseRun) -> tuple:
    ids = run.input.ids
    crack_id = ids["crack"]["id"]
    event = next(row for row in run.input.events.values() if row["pointId"] == crack_id)
    return (
        crack_id,
        ids["crack2"]["id"],
        event,
        event["eventNo"],
        run.input.field["issue"],
        run.input.field["order"],
    )


def _point_cases(run: CaseRun, crack_id: str, crack2_id: str) -> None:
    # 1 显式测点 + 当前读数
    reply = run.ask("q01", "B05-F2-CRACK01 现在怎么样")
    run.add(
        "q01",
        "B05-F2-CRACK01 现在怎么样",
        basic(reply["answer"], "point_status") + point_checks(reply["answer"], crack_id, "0.82"),
        reply,
    )

    # 2 无线索追问沿用上一轮
    reply = run.ask("q02", "它现在怎么样", {"pointId": crack_id, "source": "previous"})
    run.add("q02", "它现在怎么样", point_checks(reply["answer"], crack_id, "0.82"), reply)

    # 3 问句新对象覆盖旧上下文
    reply = run.ask("q03", "B05-F2-CRACK02 现在怎么样", {"pointId": crack_id, "source": "previous"})
    run.add(
        "q03",
        "B05-F2-CRACK02 现在怎么样（旧上下文为 CRACK01）",
        point_checks(reply["answer"], crack2_id, "0.42"),
        reply,
    )

    # 4 趋势
    reply = run.ask("q04", "B05-F2-CRACK02 最近趋势怎么样")
    samples = reply["answer"].get("extras", {}).get("samples", [])
    run.add(
        "q04",
        "B05-F2-CRACK02 最近趋势怎么样",
        basic(reply["answer"], "point_trend")
        + [
            check("object_point", reply["answer"]["objects"]["pointId"] == crack2_id),
            check("samples", len(samples) >= 1 and samples[-1]["value"] == 0.42, str(samples[-1:])),
        ],
        reply,
    )


def _event_cases(run: CaseRun, event: dict, event_no: str) -> None:
    # 5 事件追因（编号）
    reply = run.ask("q05", f"{event_no} 为什么是红色")
    run.add(
        "q05",
        f"{event_no} 为什么是红色",
        basic(reply["answer"], "event_reason")
        + [
            check("object_event", reply["answer"]["objects"]["eventId"] == event["id"]),
            check(
                "fact_event",
                event_no in fact(reply["answer"], "事件"),
                fact(reply["answer"], "事件"),
            ),
            check("evidence", any(row["kind"] == "record" for row in reply["answer"]["evidence"])),
        ],
        reply,
    )

    # 6 事件追问
    reply = run.ask("q06", "这条为什么", {"eventId": event["id"], "source": "previous"})
    run.add(
        "q06",
        "这条为什么（沿用事件上下文）",
        [
            check("intent", reply["answer"]["intent"] == "event_reason"),
            check("object_event", reply["answer"]["objects"]["eventId"] == event["id"]),
        ],
        reply,
    )

    # 7 未关闭队列
    reply = run.ask("q07", "现在有哪些未处理预警")
    run.add(
        "q07",
        "现在有哪些未处理预警",
        basic(reply["answer"], "open_events")
        + [
            check(
                "fact_count",
                fact(reply["answer"], "未关闭事件") == "1",
                fact(reply["answer"], "未关闭事件"),
            ),
            check(
                "evidence_event",
                any(row["id"] == event["id"] for row in reply["answer"]["evidence"]),
            ),
        ],
        reply,
    )


def _issue_cases(run: CaseRun, issue: dict, order: dict) -> None:
    # 8 全校概况
    reply = run.ask("q08", "全校现在概况如何")
    run.add(
        "q08",
        "全校现在概况如何",
        basic(reply["answer"], "campus_overview")
        + [
            check(
                "fact_archive",
                fact(reply["answer"], "在册楼栋 / 测点 / 设备") == "2 / 4 / 1",
                fact(reply["answer"], "在册楼栋 / 测点 / 设备"),
            ),
            check(
                "fact_records",
                fact(reply["answer"], "有效监测记录") == "7",
                fact(reply["answer"], "有效监测记录"),
            ),
            check(
                "fact_open",
                fact(reply["answer"], "未关闭事件 / 问题 / 工单") == "1 / 2 / 1",
                fact(reply["answer"], "未关闭事件 / 问题 / 工单"),
            ),
        ],
        reply,
    )

    # 9 问题编号与工单
    reply = run.ask("q09", f"{issue['issueNo']} 现在是什么状态")
    run.add(
        "q09",
        f"{issue['issueNo']} 现在是什么状态",
        basic(reply["answer"], "issue_status")
        + [
            check("object_issue", reply["answer"]["objects"]["issueId"] == issue["id"]),
            check(
                "fact_status",
                fact(reply["answer"], "状态") == "repairing",
                fact(reply["answer"], "状态"),
            ),
            check(
                "fact_order",
                order["orderNo"] in fact(reply["answer"], "工单"),
                fact(reply["answer"], "工单"),
            ),
        ],
        reply,
    )

    # 10 工单编号绑定问题与工单
    reply = run.ask("q10", f"{order['orderNo']} 验收了吗")
    run.add(
        "q10",
        f"{order['orderNo']} 验收了吗",
        basic(reply["answer"], "issue_status")
        + [
            check(
                "object_order",
                reply["answer"]["objects"]["workOrderId"] == order["id"],
                str(reply["answer"]["objects"]["workOrderId"]),
            ),
            check(
                "object_issue",
                reply["answer"]["objects"]["issueId"] == issue["id"],
                str(reply["answer"]["objects"]["issueId"]),
            ),
            check(
                "fact_order",
                order["orderNo"] in fact(reply["answer"], "工单"),
                fact(reply["answer"], "工单"),
            ),
        ],
        reply,
    )
