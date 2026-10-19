"""检查项答案归一化：只接受快照内的 key、明确结果与不重复作答。"""

CHECK_RESULTS = {"ok", "abnormal", "normal"}


def checklist_labels(checklist: list[dict]) -> dict[str, str]:
    return {
        str(item.get("key", "")): str(item.get("label", ""))
        for item in checklist
        if str(item.get("key", "")).strip()
    }


def normalize_answers(answers: list[dict], checklist: list[dict]) -> list[dict]:
    labels = checklist_labels(checklist)
    normalized: list[dict] = []
    seen: set[str] = set()
    for raw in answers:
        key = str(raw.get("key", "")).strip()
        if key not in labels:
            raise ValueError(f"检查项 {key or '（空）'} 不属于本次任务/保养清单")
        if key in seen:
            raise ValueError(f"检查项 {labels[key]} 重复作答")
        seen.add(key)
        result = str(raw.get("result", "")).strip()
        if result not in CHECK_RESULTS:
            raise ValueError(f"检查项 {labels[key]} 的结果必须是「正常 / 异常」")
        normalized.append(
            {
                "key": key,
                "label": labels[key],
                "result": "ok" if result == "normal" else result,
                "note": str(raw.get("note", "")).strip(),
            }
        )
    return normalized
