from collections.abc import Callable

from .prepare import problem

ARRAY_REFS = {
    "plans": {"floorIds": "floors", "pointIds": "points"},
    "rules": {"buildingIds": "buildings", "pointIds": "points"},
    "tasks": {"issueIds": "issues"},
    "issues": {"photos": "attachments", "workOrderIds": "workOrders", "linkedFrom": "issues"},
    "workOrders": {"photos": "attachments"},
}


def validate_links(data: dict, lookup: Callable, errors: list) -> None:
    for table, fields in ARRAY_REFS.items():
        for row in data[table]:
            for field, target in fields.items():
                for identifier in row.get(field, []):
                    linked = lookup(target, identifier)
                    if linked is None:
                        errors.append(
                            problem(table, row["id"], f"{field} 引用了不存在的 {identifier}")
                        )
                    elif field == "photos":
                        owner = "issueId" if table == "issues" else "workOrderId"
                        if linked.get(owner) != row["id"]:
                            errors.append(
                                problem(table, row["id"], f"照片 {identifier} 的归属不匹配")
                            )
    for task in data["tasks"]:
        for result in task.get("results", []):
            if lookup("points", result["pointId"]) is None:
                errors.append(problem("tasks", task["id"], "逐点结果的测点不存在"))
            identifier = (result.get("abnormalHandling") or {}).get("linkedIssueId")
            if identifier and lookup("issues", identifier) is None:
                errors.append(problem("tasks", task["id"], "异常处理引用的问题不存在"))
    for task in data["maintenanceTasks"]:
        execution = task.get("execution") or {}
        identifier = execution.get("issueId")
        issue = lookup("issues", identifier) if identifier else None
        if identifier and (issue is None or issue.get("maintenanceTaskId") != task["id"]):
            errors.append(problem("maintenanceTasks", task["id"], "保养转问题的双向关联不一致"))
        for identifier in execution.get("photos", []):
            photo = lookup("attachments", identifier)
            if photo is None or photo.get("maintenanceTaskId") != task["id"]:
                errors.append(problem("maintenanceTasks", task["id"], "保养照片归属不匹配"))
    for event in data["events"]:
        evidences = event.get("evidences", []) + [
            item["evidence"] for item in event.get("supersededEvidences", [])
        ]
        for evidence in evidences:
            if lookup("records", evidence["recordId"]) is None:
                errors.append(problem("events", event["id"], "预警证据引用的记录不存在"))
