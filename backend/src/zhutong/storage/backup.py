import json
import os
import shutil
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy.engine import make_url

from ..core.errors import AppError
from ..core.security import signing_key
from ..core.settings import Settings
from .backup_manifest import FORMAT, fingerprint, inspect_database, verify_backup
from .files import safe_child

__all__ = ["create_backup", "restore_backup", "verify_backup"]


@contextmanager
def staged_directory(destination: Path) -> Iterator[Path]:
    output = destination.resolve()
    if output.exists():
        raise AppError("BACKUP_TARGET_EXISTS", "目标目录已存在，备份及恢复不会覆盖已有内容", 409)
    staging = output.with_name(output.name + ".partial-" + uuid.uuid4().hex)
    staging.mkdir(parents=True)
    try:
        yield staging
        if output.exists():
            raise AppError("BACKUP_TARGET_EXISTS", "目标目录已存在", 409)
        os.rename(staging, output)
    finally:
        if staging.exists():
            if staging.parent != output.parent or ".partial-" not in staging.name:
                raise RuntimeError("备份暂存目录越界")
            shutil.rmtree(staging)


def snapshot_database(settings: Settings, target: Path) -> None:
    path = make_url(settings.database_url).database
    if path is None or not Path(path).is_file():
        raise AppError("INVALID_BACKUP", "待备份数据库不存在", 404)
    source_url = Path(path).resolve().as_uri() + "?mode=ro"
    with closing(sqlite3.connect(source_url, uri=True)) as source:
        with closing(sqlite3.connect(target)) as destination:
            source.backup(destination)


def copy_media(settings: Settings, staging: Path, manifest: dict) -> None:
    with closing(sqlite3.connect(staging / "zhutong.sqlite")) as connection:
        rows = connection.execute("SELECT storage_key,size,sha256 FROM media_files").fetchall()
    for key, size, digest in rows:
        relative = "media/" + key
        source = safe_child(settings.runtime_dir / "media", key)
        destination = safe_child(staging, relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        actual = fingerprint(destination)
        if actual != {"size": size, "sha256": digest}:
            raise AppError("INVALID_BACKUP", "媒体文件完整性校验失败", 422)
        manifest["files"][relative] = actual


def create_backup(settings: Settings, destination: Path) -> dict:
    with staged_directory(destination) as staging:
        snapshot_database(settings, staging / "zhutong.sqlite")
        database = inspect_database(staging / "zhutong.sqlite")
        manifest = {
            "format": FORMAT,
            "createdAt": datetime.now(UTC).isoformat(),
            "schemaRevision": database["schemaRevision"],
            "tables": database["tables"],
            "files": {},
        }
        (staging / "session.key").write_text(signing_key(settings), encoding="utf-8")
        for key in ("zhutong.sqlite", "session.key"):
            manifest["files"][key] = fingerprint(staging / key)
        copy_media(settings, staging, manifest)
        (staging / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        verify_backup(staging)
    return manifest


def restore_backup(source: Path, destination: Path) -> dict:
    manifest = verify_backup(source)
    with staged_directory(destination) as staging:
        for key in [*manifest["files"], "manifest.json"]:
            output = safe_child(staging, key)
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(safe_child(source, key), output)
        verify_backup(staging)
    return manifest
