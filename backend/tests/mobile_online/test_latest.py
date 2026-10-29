from monitoring.fixtures import Api


def test_mobile_records_keep_latest_five_per_point_instead_of_global_oldest_slice(client, settings):
    api = Api(client, str(settings.database_url))
    ids = api.seed_crack()
    rows = [api.add_record(ids["point"]["id"], 0.55, minutes=-20 + n)["record"] for n in range(7)]
    recent = api.get("/mobile/records")
    assert {row["id"] for row in recent} == {row["id"] for row in rows[-5:]}
    token = api.add_scoped_user("latest-empty", [])
    assert (
        client.get(
            "/api/v1/datasets/demo-main/mobile/records",
            headers={"Authorization": f"Bearer {token}"},
        ).json()["data"]
        == []
    )
