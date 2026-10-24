# ruff: noqa: E501
"""规则停用与试算：不回退旧版本，候选阈值实际解析且不写库。"""

from stage7_checks import basic, check, fact
from stage7_http_support import snapshot

from .shared import new_rule_version


def rule_disable(api, state: dict, add, ask) -> None:
    rule = api.get("/rules")[0]
    disabled = new_rule_version(api, rule, False, "q36-disable")
    off = ask("q36", "B05-F2-CRACK01 现在怎么样")
    add(
        "q36",
        "规则停用后询问测点状态（不得回退旧版本）",
        [
            check(
                "disabled_version",
                disabled["enabled"] is False and disabled["version"] != rule["version"],
                disabled["version"],
            ),
            check(
                "no_rule_fact",
                fact(off["answer"], "适用规则") == "",
                fact(off["answer"], "适用规则"),
            ),
            check(
                "explicit_gap",
                fact(off["answer"], "判定").startswith("未判定"),
                fact(off["answer"], "判定"),
            ),
            check(
                "snapshot_no_rule",
                off["answer"]["snapshot"]["rules"] == [],
                str(off["answer"]["snapshot"]["rules"]),
            ),
        ],
        off,
    )
    enabled = new_rule_version(api, disabled, True, "q36-enable")
    on = ask("q36b", "B05-F2-CRACK01 现在怎么样")
    add(
        "q36b",
        "恢复启用后重新判定",
        [
            check(
                "enabled_version",
                enabled["enabled"] is True and enabled["version"] != disabled["version"],
                enabled["version"],
            ),
            check(
                "rule_fact",
                enabled["version"] in fact(on["answer"], "适用规则"),
                fact(on["answer"], "适用规则"),
            ),
            check(
                "snapshot_rule",
                [row.get("version") for row in on["answer"]["snapshot"]["rules"]]
                == [enabled["version"]],
                str(on["answer"]["snapshot"]["rules"]),
            ),
        ],
        on,
    )


def trial(api, state: dict, add, ask) -> None:
    before = snapshot(api)
    reply = ask("q37", "B05-F2-CRACK01 如果黄色阈值改为 0.15 试算")
    rows = reply["answer"].get("extras", {}).get("simulation", [])
    add(
        "q37",
        "B05-F2-CRACK01 如果黄色阈值改为 0.15 试算",
        basic(reply["answer"], "rule_simulate")
        + [
            check(
                "candidate_text",
                "0.15" in reply["answer"]["conclusion"],
                reply["answer"]["conclusion"][:80],
            ),
            check("engine_rows", len(rows) == 5, str(len(rows))),
            check(
                "engine_levels",
                all(row.get("original") and row.get("candidate") for row in rows),
                str(rows[:1]),
            ),
            check("no_writes", snapshot(api) == before),
        ],
        reply,
    )

    missing = ask("q37b", "B05-F2-CRACK01 如果阈值改成 0.1/0.2/0.3 试算")
    add(
        "q37b",
        "候选阈值不完整时先澄清，不使用默认值",
        [
            check(
                "need_choice",
                missing["answer"]["status"] == "need_choice",
                missing["answer"]["status"],
            ),
            check("no_rows", missing["answer"].get("extras", {}).get("simulation", []) == []),
            check(
                "prompt",
                "候选阈值" in missing["answer"]["conclusion"],
                missing["answer"]["conclusion"][:80],
            ),
        ],
        missing,
    )
