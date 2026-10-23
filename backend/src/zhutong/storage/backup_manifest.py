import json
import sqlite3
from contextlib import closing
from pathlib import Path

from ..core.errors import AppError
from .files import safe_child
from .integrity import fingerprint as fingerprint

FORMAT = "zhutong-server-backup-v1"


def inspect_database(path: Path) -> dict:
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as connection:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise AppError("INVALID_BACKUP", "数据库完整性检查未通过", 422)
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise AppError("INVALID_BACKUP", "数据库引用完整性检查未通过", 422)
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        counts = {
            name: connection.execute(
                'SELECT count(*) FROM "' + name.replace('"', '""') + '"'
            ).fetchone()[0]
            for name in tables
        }
        revision = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
        media = [row[0] for row in connection.execute("SELECT storage_key FROM media_files")]
    return {"schemaRevision": revision, "tables": counts, "media": media}


def verify_backup(directory: Path) -> dict:
    root = directory.resolve()
    try:
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        if manifest["format"] != FORMAT or not isinstance(manifest["files"], dict):
            raise ValueError("格式无效")
        for key, expected in manifest["files"].items():
            if fingerprint(safe_child(root, key)) != expected:
                raise ValueError("文件哈希或体积不一致")
        database = inspect_database(root / "zhutong.sqlite")
        required = {"zhutong.sqlite", "session.key", *("media/" + key for key in database["media"])}
        if "modelFiles" in manifest:
            from .knowledge_backup import model_entries

            model_keys = model_entries(root)
            if not model_keys or sorted(model_keys) != sorted(manifest["modelFiles"]):
                raise ValueError("模型备份清单不完整")
            required.update(model_keys)
        if required != set(manifest["files"]):
            raise ValueError("文件清单不完整")
        if any(manifest[key] != database[key] for key in ("tables", "schemaRevision")):
            raise ValueError("数据库清单不一致")
        if len((root / "session.key").read_text(encoding="utf-8").strip()) < 32:
            raise ValueError("签名密钥无效")
        return manifest
    except (OSError, ValueError, KeyError, TypeError, sqlite3.DatabaseError) as error:
        raise AppError("INVALID_BACKUP", "备份完整性校验失败", 422) from error
