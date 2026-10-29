from pathlib import Path

import pytest
from conftest import demo_token
from fastapi.testclient import TestClient

from zhutong.app import create_app
from zhutong.core.errors import AppError
from zhutong.core.settings import Settings
from zhutong.db.database import Database
from zhutong.storage.backup import create_backup, restore_backup, verify_backup

from .test_media import PNG, upload


def test_backup_restore_preserves_database_media_and_identity(
    client: TestClient, database: Database, settings: Settings, tmp_path: Path
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    photo = upload(client, headers)
    destination = tmp_path / "backup"
    manifest = create_backup(settings, destination)
    assert manifest["tables"]["media_files"] == 1
    assert manifest["tables"]["users"] == 5
    assert verify_backup(destination)["schemaRevision"] == "0014_device_telemetry"
    restored = tmp_path / "restored-runtime"
    restore_backup(destination, restored)
    configured = Settings(
        runtime_dir=restored,
        database_url=f"sqlite:///{(restored / 'zhutong.sqlite').as_posix()}",
        secret_key="",
    )
    with TestClient(create_app(configured)) as after:
        assert after.get(photo["contentUrl"], headers=headers).content == PNG


def test_corrupt_or_unsafe_backups_are_rejected_before_restore(
    client: TestClient, database: Database, settings: Settings, tmp_path: Path
) -> None:
    headers = {"Authorization": f"Bearer {demo_token(client)}"}
    upload(client, headers)
    backup = tmp_path / "backup"
    create_backup(settings, backup)
    media = next(path for path in (backup / "media" / "files").rglob("*") if path.is_file())
    media.write_bytes(b"tampered")
    restored = tmp_path / "restore"
    with pytest.raises(AppError, match="完整性"):
        restore_backup(backup, restored)
    assert not restored.exists()


def test_backup_and_restore_never_overwrite_existing_directories(
    database: Database, settings: Settings, tmp_path: Path
) -> None:
    backup = tmp_path / "backup"
    create_backup(settings, backup)
    with pytest.raises(AppError):
        create_backup(settings, backup)
    with pytest.raises(AppError):
        restore_backup(backup, settings.runtime_dir)
