"""原生持久上传需要服务端明确返回已校验的数据集版本。"""

from ..fixtures import PNG, FieldApi


def test_upload_and_replay_include_dataset_epoch(client, settings):
    api = FieldApi(client, str(settings.database_url))
    point = api.seed_manual_point()["manual"]
    headers = {"Authorization": f"Bearer {api.token}", "Content-Type": "image/png",
               "Idempotency-Key": "media-epoch", "X-Dataset-Epoch": "1"}
    path = f"/api/v1/datasets/demo-main/media?fileName=epoch.png&pointId={point['id']}"
    first = client.post(path, content=PNG, headers=headers)
    assert first.status_code == 201
    assert first.json()["meta"]["datasetEpoch"] == 1
    second = client.post(path, content=PNG, headers=headers)
    assert second.status_code == 200
    assert second.json()["meta"]["datasetEpoch"] == 1
    assert second.json()["data"]["id"] == first.json()["data"]["id"]
