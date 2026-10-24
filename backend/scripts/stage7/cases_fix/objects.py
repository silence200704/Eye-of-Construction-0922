# ruff: noqa: E501
"""对象绑定与候选点击：错楼栋/楼层、同点多问题、事件与工单上下文。"""

from stage7_checks import check, fact, point_checks

from .shared import latest_value


def object_binding(api, state: dict, add, ask) -> None:
    ids = state["ids"]
    other = ids["otherPoint"]

    # 31 别的楼栋必须回答该楼栋的测点，不能串到 B05
    reply = ask("q31", "B06-F1-CRACK01 现在怎么样")
    add(
        "q31",
        "B06-F1-CRACK01 现在怎么样",
        point_checks(reply["answer"], other["id"], latest_value(api, other["id"]))
        + [
            check(
                "building_bound",
                reply["answer"]["objects"]["buildingId"] == other["buildingId"],
                str(reply["answer"]["objects"]["buildingId"]),
            )
        ],
        reply,
    )

    # 32 楼层不存在时不能借用同楼栋其他测点
    reply = ask("q32", "B05-F3-CRACK01 现在怎么样")
    add(
        "q32",
        "B05-F3-CRACK01 现在怎么样",
        [
            check("status", reply["answer"]["status"] == "not_found", reply["answer"]["status"]),
            check("object_null", reply["answer"]["objects"]["pointId"] is None),
            check("facts_empty", reply["answer"]["facts"] == []),
        ],
        reply,
    )


def issue_binding(api, state: dict, add, ask) -> None:
    second = state["second_issue"]

    # 33 同一测点两条问题：显式编号与上下文都不能绑错
    explicit = ask("q33", f"{second['issueNo']} 现在是什么状态")
    context = ask("q33b", "它现在是什么状态", {"issueId": second["id"], "source": "page"})
    add(
        "q33",
        f"{second['issueNo']} 现在是什么状态；同点第二条问题上下文追问",
        [
            check(
                "explicit_object",
                explicit["answer"]["objects"]["issueId"] == second["id"],
                str(explicit["answer"]["objects"]["issueId"]),
            ),
            check(
                "explicit_status",
                any(row["label"] == "状态" for row in explicit["answer"]["facts"]),
                str([row["label"] for row in explicit["answer"]["facts"]]),
            ),
            check(
                "context_object",
                context["answer"]["objects"]["issueId"] == second["id"],
                str(context["answer"]["objects"]["issueId"]),
            ),
            check("context_no_order", context["answer"]["objects"]["workOrderId"] is None),
        ],
        explicit,
    )


def followup_binding(api, state: dict, add, ask) -> None:
    order = state["order"]

    # 34 事件由测点唯一确定；问题工单按上下文保持稳定 ID
    event_reply = ask("q34", "B05-F2-CRACK01 为什么报警")
    order_reply = ask("q34b", "这个工单到哪一步了", {"workOrderId": order["id"], "source": "page"})
    add(
        "q34",
        "B05-F2-CRACK01 为什么报警；工单上下文追问",
        [
            check(
                "event_intent",
                event_reply["answer"]["intent"] == "event_reason",
                event_reply["answer"]["intent"],
            ),
            check(
                "event_bound",
                event_reply["answer"]["objects"]["eventId"] == state["event"]["id"],
                str(event_reply["answer"]["objects"]["eventId"]),
            ),
            check(
                "order_intent",
                order_reply["answer"]["intent"] == "issue_status",
                order_reply["answer"]["intent"],
            ),
            check(
                "order_bound",
                order_reply["answer"]["objects"]["workOrderId"] == order["id"],
                str(order_reply["answer"]["objects"]["workOrderId"]),
            ),
            check(
                "order_fact",
                order["orderNo"] in fact(order_reply["answer"], "工单"),
                fact(order_reply["answer"], "工单"),
            ),
        ],
        order_reply,
    )


def candidate_click(api, state: dict, add, ask) -> None:
    # 35 候选返回后按真实点击上下文继续问，不得 422
    reply = ask("q35", "5号实验楼的裂缝测点现在怎么样")
    candidates = reply["answer"].get("candidates", [])
    target = next(
        (row for row in candidates if row["label"].startswith("B05-F2-CRACK02")),
        candidates[0] if candidates else None,
    )
    clicked = (
        ask(
            "q35b",
            "5号实验楼的裂缝测点现在怎么样",
            {"pointId": target["id"], "source": "page"},
        )
        if target
        else reply
    )
    add(
        "q35",
        "5号实验楼的裂缝测点现在怎么样 → 点击第二个候选后追问",
        [
            check(
                "need_choice", reply["answer"]["status"] == "need_choice", reply["answer"]["status"]
            ),
            check("candidate_count", len(candidates) >= 2, str(len(candidates))),
            check(
                "clicked_answered",
                clicked["answer"]["status"] == "answered",
                clicked["answer"]["status"],
            ),
            check(
                "clicked_object",
                target is not None and clicked["answer"]["objects"]["pointId"] == target["id"],
                str(clicked["answer"]["objects"]["pointId"]),
            ),
            check(
                "clicked_fact",
                target is not None
                and fact(clicked["answer"], "当前读数") == latest_value(api, target["id"]),
                fact(clicked["answer"], "当前读数"),
            ),
        ],
        clicked,
    )
