"""S7-01 / S7-03：动态问题读当前服务端事实，对象与查询时刻可追溯。"""

from fastapi.testclient import TestClient

from .fixtures import AssistantApi


def test_point_status_binds_object_and_reads_latest_record(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    record = api.add_record(ids["point"]["id"], 0.42, minutes=-30)
    reply = api.ask("B03-F2-CRACK01 现在怎么样", key="ask-point")
    answer = reply["answer"]
    assert answer["intent"] == "point_status"
    assert answer["status"] == "answered"
    assert answer["objects"]["pointId"] == ids["point"]["id"]
    values = {row["label"]: row["value"] for row in answer["facts"]}
    assert values["当前读数"] == "0.42"
    evidence = [row for row in answer["evidence"] if row["kind"] == "record"]
    assert any(row["ref"] == record["record"]["recordNo"] for row in evidence)
    assert answer["sources"]["facts"] == "server_db"
    assert answer["sources"]["queriedAt"]


def test_event_reason_uses_event_number_and_lists_evidence(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_red_event()
    event = ids["event"]
    reply = api.ask(f"{event['eventNo']} 为什么是红色", key="ask-event")
    answer = reply["answer"]
    assert answer["intent"] == "event_reason"
    assert answer["objects"]["eventId"] == event["id"]
    assert any("活跃证据" in row["value"] or "触发规则" in row["label"] for row in answer["facts"])
    assert answer["evidence"]


def test_overview_and_open_events_count_from_database(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    api.seed_red_event()
    overview = api.ask("全校现在概况如何", key="ask-overview")["answer"]
    assert overview["intent"] == "campus_overview"
    labels = {row["label"]: row["value"] for row in overview["facts"]}
    assert labels["未关闭事件 / 问题 / 工单"].startswith("1 / ")
    queue = api.ask("现在有哪些未处理预警", key="ask-queue")["answer"]
    assert queue["intent"] == "open_events"
    assert any(row["kind"] == "event" for row in queue["evidence"])


def test_unknown_object_returns_not_found_without_fabrication(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    answer = api.ask("B99-F9-NOPE 现在怎么样", key="ask-missing")["answer"]
    assert answer["status"] == "not_found"
    assert "没有匹配" in answer["conclusion"] or "没有可绑定" in answer["conclusion"]
    assert answer["sources"]["facts"] == "none"


def test_trend_returns_samples_from_records(client: TestClient, settings) -> None:
    api = AssistantApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    api.add_record(ids["point"]["id"], 0.42, minutes=-50)
    api.add_record(ids["point"]["id"], 0.45, minutes=-20)
    answer = api.ask("B03-F2-CRACK01 最近趋势怎么样", key="ask-trend")["answer"]
    assert answer["intent"] == "point_trend"
    assert answer["extras"]["samples"]
    values = [row["value"] for row in answer["extras"]["samples"]]
    assert values[-1] == 0.45
