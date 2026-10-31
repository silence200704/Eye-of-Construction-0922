"""演示准备与复位只能操作专用数据集，不改变正式业务库。"""

from ..fixtures import FieldApi


def send(api, action, key, options=None):
    spec = {"epoch": 1, "dataset": "demo-showcase", "account": "demo-safety"} | (options or {})
    epoch, dataset, account = spec["epoch"], spec["dataset"], spec["account"]
    return api.client.post(
        f"/api/v1/datasets/{dataset}/showcase/{action}",
        json={"confirmDataset": dataset} if action == "reset" else {},
        headers={
            "Authorization": f"Bearer {api.token_for(account)}",
            "X-Dataset-Epoch": str(epoch),
            "Idempotency-Key": key,
        },
    )


def test_showcase_prepare_is_repeat_safe_and_reset_is_scoped(client, settings):
    api = FieldApi(client, str(settings.database_url))
    assert send(api, "prepare", "no-main", options={"dataset": "demo-main"}).status_code == 403
    assert send(api, "prepare", "no-repair", options={"account": "demo-repair"}).status_code == 403
    prepared = send(api, "prepare", "prepare-1")
    assert prepared.status_code == 200, prepared.text
    original = prepared.json()["data"]
    assert original["counts"]["tasks"] >= 1
    assert original["counts"]["orders"] == 0
    assert send(api, "prepare", "prepare-2").json()["data"]["counts"] == original["counts"]
    assert send(api, "pause", "pause-1").json()["data"]["phase"] == "paused"
    assert send(api, "resume", "resume-1").json()["data"]["phase"] == "ready"
    reset = send(api, "reset", "reset-1")
    assert reset.status_code == 200, reset.text
    assert reset.json()["meta"]["datasetEpoch"] == 2
    assert reset.json()["data"]["counts"]["tasks"] == 0
    assert send(api, "reset", "reset-1").json()["meta"]["datasetEpoch"] == 2
    assert send(api, "prepare", "stale-prepare", options={"epoch": 1}).status_code == 409
    assert api.get("/archive")["epoch"] == 1


def test_showcase_samples_use_real_assessment_and_pause_blocks_sampling(client, settings):
    api = FieldApi(client, str(settings.database_url))
    send(api, "prepare", "prepare-samples")
    headers = {
        "Authorization": f"Bearer {api.token}",
        "X-Dataset-Epoch": "1",
        "Idempotency-Key": "red-sample",
    }
    url = "/api/v1/datasets/demo-showcase/showcase/sample"
    red = client.post(url, json={"sensor": "crack", "level": "red"}, headers=headers)
    assert red.status_code == 200, red.text
    assert red.json()["data"]["results"][0]["assessment"]["state"] == "red"
    send(api, "pause", "pause-samples")
    headers["Idempotency-Key"] = "paused-sample"
    assert (
        client.post(url, json={"sensor": "crack", "level": "normal"}, headers=headers).status_code
        == 409
    )
