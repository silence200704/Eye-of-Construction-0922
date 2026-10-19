"""R5-05：巡检与保养答案只接受快照 key、合法结果且不得重复。"""

from fastapi.testclient import TestClient

from ..fixtures import FieldApi, today


def _arrived_task(api: FieldApi, point_id: str, label: str) -> dict:
    task = api.task_for_point(point_id)
    return api.ok_post(
        f"/inspection/tasks/{task['id']}/check-in",
        {
            "expectedRev": task["rev"],
            "pointId": point_id,
            "method": "nfc",
            "labelRead": label,
        },
        "answers-arrive-" + task["id"],
        "demo-inspector",
    )["task"]


def test_empty_unknown_and_duplicate_answers_are_rejected(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point = ids["manual"]
    api.create_plan(point["id"], ids["building"]["id"], ids["floor"]["id"])
    api.generate(key="answers-generate")
    arrived = _arrived_task(api, point["id"], point["nfc"]["code"])
    path = f"/inspection/tasks/{arrived['id']}/complete-point"
    cases = [
        ([{"key": "wall", "result": ""}], "空结果"),
        ([{"key": "wall", "result": "looks-fine"}], "未知结果"),
        ([{"key": "missing", "result": "ok"}], "未知 key"),
        ([{"key": "wall", "result": "ok"}, {"key": "wall", "result": "ok"}], "重复 key"),
    ]
    for index, (answers, label) in enumerate(cases):
        response = api.fpost(
            path,
            {"expectedRev": arrived["rev"], "pointId": point["id"], "answers": answers},
            f"answers-bad-{index}",
            "demo-inspector",
        )
        assert response.status_code == 422, (label, response.text)
    stored = api.task_for_point(point["id"])
    assert stored["status"] != "checked"
    assert stored["results"][0]["status"] == "arrived"


def test_normal_is_converted_and_label_comes_from_snapshot(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    point = ids["manual"]
    api.create_plan(point["id"], ids["building"]["id"], ids["floor"]["id"])
    api.generate(key="answers-normal-generate")
    arrived = _arrived_task(api, point["id"], point["nfc"]["code"])
    completed = api.ok_post(
        f"/inspection/tasks/{arrived['id']}/complete-point",
        {
            "expectedRev": arrived["rev"],
            "pointId": point["id"],
            "answers": [{"key": "wall", "label": "伪造标签", "result": "normal"}],
        },
        "answers-normal",
        "demo-inspector",
    )["task"]
    assert completed["status"] == "checked"
    assert completed["results"][0]["checklist"][0]["result"] == "ok"
    assert completed["results"][0]["checklist"][0]["label"] == "墙面"


def test_maintenance_rejects_invalid_answers(client: TestClient, settings) -> None:
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_crack()
    api.create_maintenance_plan(ids["device"]["id"], ids["building"]["id"])
    task = api.generate_maintenance(day=today(), key="answers-maintenance")["created"][0]
    response = api.fpost(
        f"/maintenance/tasks/{task['id']}/execute",
        {
            "expectedRev": task["rev"],
            "answers": [{"key": "bolt", "result": ""}],
            "measures": "空结果不能完成保养",
            "nextDueDate": today(),
        },
        "answers-maintenance-bad",
    )
    assert response.status_code == 422
    assert api.get("/maintenance/tasks")[0]["status"] == "pending"
