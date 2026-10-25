"""An explicit unbound order must not inherit another point/event graph."""

from probes import mixed_context_graph, previous


def test_explicit_order_does_not_inherit_unrelated_point_or_event(tmp_path):
    settings = previous.Settings(
        runtime_dir=tmp_path,
        database_url=f"sqlite:///{(tmp_path / 'review.sqlite').as_posix()}",
    )
    previous.initialize(settings)
    with previous.TestClient(previous.create_app(settings)) as client:
        api = previous.AssistantApi(client, str(settings.database_url))
        ids = api.seed_manual_point()
        api.add_record(ids["point"]["id"], 0.82, minutes=-15)
        result = mixed_context_graph(api, ids, previous.unbound_scope(api, ids))
    assert result["actualIssue"]["pointId"] is None
    assert result["actualIssue"]["eventId"] is None
    assert result["order"]["pointId"] is None
    answer = result["result"]["response"]["data"]["answer"]
    assert answer["objects"]["issueId"] == result["actualIssue"]["id"]
    assert answer["objects"]["pointId"] is None, answer["objects"]
    assert answer["objects"]["eventId"] is None, answer["objects"]
    assert "pointId" not in answer["snapshot"]["objects"]
    assert "eventId" not in answer["snapshot"]["objects"]
