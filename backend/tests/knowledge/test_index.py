import json

import numpy as np
from monitoring.fixtures import Api
from sqlalchemy import create_engine, text

from zhutong.domain.knowledge.model import ModelUnavailable
from zhutong.storage.backup import create_backup, restore_backup

from .test_api import document, post


class Encoder:
    model_id = "unit-test-only"
    revision = "test-revision"
    fingerprint = "test-manifest"
    dimension = 3
    fail = False

    def encode(self, texts, query=False):
        if self.fail and not query:
            raise ModelUnavailable("测试模拟编码失败")
        return np.tile(np.asarray([1, 0, 0], dtype="<f4"), (len(texts), 1))


def test_rebuild_failure_preserves_previous_complete_index(client, settings, monkeypatch):
    api = Api(client, str(settings.database_url))
    document(api)
    encoder = Encoder()
    monkeypatch.setattr("zhutong.operations.knowledge.indexing.get_encoder", lambda _: encoder)
    first = api.ok(post(api, "/indexes/rebuild", {}))
    assert first["built"]
    found = api.ok(post(api, "/search", {"query": "预警事件关闭"}))
    assert found["mode"] == "hybrid"
    assert "vector" in found["candidates"][0]["methods"]
    encoder.fail = True
    failed = api.ok(post(api, "/indexes/rebuild", {}))
    assert not failed["built"] and failed["error"]
    assert failed["activeIndexId"] == first["activeIndexId"]
    assert api.ok(post(api, "/search", {"query": "预警事件关闭"}))["mode"] == "hybrid"


def test_corrupt_vector_and_changed_model_are_explicitly_invalid(client, settings, monkeypatch):
    api = Api(client, str(settings.database_url))
    document(api)
    encoder = Encoder()
    monkeypatch.setattr("zhutong.operations.knowledge.indexing.get_encoder", lambda _: encoder)
    api.ok(post(api, "/indexes/rebuild", {}))
    engine = create_engine(str(settings.database_url))
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE knowledge_vectors SET embedding=:value"), {"value": b"broken"}
        )
    engine.dispose()
    found = api.ok(post(api, "/search", {"query": "预警事件关闭"}))
    assert found["mode"] == "keyword" and "损坏" in found["degradedReason"]
    api.ok(post(api, "/indexes/rebuild", {}))
    encoder.revision = "changed"
    found = api.ok(post(api, "/search", {"query": "预警事件关闭"}))
    assert found["mode"] == "keyword" and "改变" in found["degradedReason"]


def test_document_change_invalidates_index_and_never_cites_old_version(
    client, settings, monkeypatch
):
    api = Api(client, str(settings.database_url))
    doc = document(api)
    monkeypatch.setattr("zhutong.operations.knowledge.indexing.get_encoder", lambda _: Encoder())
    api.ok(post(api, "/indexes/rebuild", {}))
    api.ok(
        post(
            api,
            f"/documents/{doc['id']}/versions",
            {
                "expectedRev": doc["rev"],
                "content": "# 新流程\n\n预警事件关闭前必须核对当前恢复条件和处置依据。",
            },
        )
    )
    found = api.ok(post(api, "/search", {"query": "预警事件关闭"}))
    assert found["mode"] == "keyword" and "变更" in found["degradedReason"]
    assert all(candidate["version"] == 2 for candidate in found["candidates"])


def test_knowledge_backup_restores_local_model_and_vectors(client, settings, tmp_path):
    api = Api(client, str(settings.database_url))
    document(api)
    directory = settings.runtime_dir / "models" / "bge-small-zh-v1.5"
    directory.mkdir(parents=True)
    (directory / "model.onnx").write_bytes(b"model-fixture-for-backup-only")
    from zhutong.domain.knowledge.text import digest

    (directory / "manifest.json").write_text(
        json.dumps({"files": {"model.onnx": digest(b"model-fixture-for-backup-only")}})
    )
    create_backup(settings, tmp_path / "backup")
    restore_backup(tmp_path / "backup", tmp_path / "restore")
    target = tmp_path / "restore" / "models" / "bge-small-zh-v1.5"
    assert (target / "model.onnx").read_bytes() == b"model-fixture-for-backup-only"
