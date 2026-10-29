"""Media reset versions and standalone report replay must stay authoritative."""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from zhutong.db.models import User
from zhutong.db.models.archive import Point
from zhutong.db.models.foundation import Dataset
from zhutong.storage.files import FileStore

from ..fixtures import PNG, FieldApi, counts


def mutate(url, change, point_id):
    engine = create_engine(url)
    with Session(engine) as session, session.begin():
        if change == "scope":
            session.get(User, "demo-inspector").building_ids_json = "[]"
        elif change == "archived":
            session.get(Point, ("demo-main", point_id)).status = "archived"
        else:
            session.get(Dataset, "demo-main").epoch = 2
    engine.dispose()


@pytest.mark.parametrize("change", ["scope", "archived"])
def test_standalone_receipt_reauthorizes_location(client, settings, change):
    api = FieldApi(client, str(settings.database_url))
    ids = api.seed_manual_point()
    body = {
        "source": "report",
        "pointId": ids["manual"]["id"],
        "buildingId": ids["building"]["id"],
        "anomalyType": "墙面异常",
        "description": "独立上报回执授权检查",
        "submissionId": "native-independent-stable",
        "photos": [],
    }
    api.ok_post("/issues", body, "standalone-stable", "demo-inspector")
    before = counts(str(settings.database_url), "issues", "audits", "operation_receipts")
    mutate(str(settings.database_url), change, body["pointId"])
    result = api.fpost("/issues", body, "standalone-stable", "demo-inspector")
    assert result.status_code == (404 if change == "archived" else 403)
    assert counts(str(settings.database_url), "issues", "audits", "operation_receipts") == before


@pytest.mark.parametrize("header,code", [("0", 400), ("invalid", 400), ("2", 409)])
def test_media_supplied_reset_version_is_checked_without_file_or_audit(
    client, settings, header, code
):
    api = FieldApi(client, str(settings.database_url))
    before = counts(str(settings.database_url), "media_files", "audits")
    result = client.post(
        "/api/v1/datasets/demo-main/media?fileName=photo.png",
        content=PNG,
        headers={
            "Authorization": f"Bearer {api.token}",
            "Content-Type": "image/png",
            "Idempotency-Key": "native-photo-version",
            "X-Dataset-Epoch": header,
        },
    )
    assert result.status_code == code
    assert counts(str(settings.database_url), "media_files", "audits") == before
    assert not list((settings.runtime_dir / "media").rglob("*.bin"))


def test_media_rechecks_epoch_inside_write_after_stream_is_stored(client, settings, monkeypatch):
    api = FieldApi(client, str(settings.database_url))
    original = FileStore.put

    async def reset_during_stream(store, source, mime_type):
        stored = await original(store, source, mime_type)
        mutate(str(settings.database_url), "epoch", "")
        return stored

    monkeypatch.setattr(FileStore, "put", reset_during_stream)
    before = counts(str(settings.database_url), "media_files", "audits")
    result = client.post(
        "/api/v1/datasets/demo-main/media?fileName=photo.png",
        content=PNG,
        headers={
            "Authorization": f"Bearer {api.token}",
            "Content-Type": "image/png",
            "Idempotency-Key": "native-photo-race",
            "X-Dataset-Epoch": "1",
        },
    )
    assert result.status_code == 409
    assert counts(str(settings.database_url), "media_files", "audits") == before
    assert not [p for p in (settings.runtime_dir / "media").rglob("*") if p.is_file()]
