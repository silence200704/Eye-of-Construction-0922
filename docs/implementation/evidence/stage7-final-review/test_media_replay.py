"""Expected authorization contract; intentionally RED against 2579f1f."""

from probes import media_role_replay, previous


def test_media_receipt_cannot_replay_hidden_owner_metadata(tmp_path):
    settings = previous.Settings(
        runtime_dir=tmp_path,
        database_url=f"sqlite:///{(tmp_path / 'review.sqlite').as_posix()}",
    )
    previous.initialize(settings)
    with previous.TestClient(previous.create_app(settings)) as client:
        api = previous.AssistantApi(client, str(settings.database_url))
        result = media_role_replay(api, api.seed_manual_point())
    assert result["currentRead"]["response"]["data"] == []
    assert result["currentNewCommand"]["status"] == 403
    assert result["countsBeforeReplay"] == result["countsAfterReplay"]
    assert result["replay"]["status"] in {403, 404}, result["replay"]
