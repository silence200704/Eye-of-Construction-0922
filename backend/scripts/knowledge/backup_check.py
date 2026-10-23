"""真实模型/知识/索引备份恢复，逐表内容及逐文件哈希核对。"""

import argparse
import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from zhutong.core.settings import Settings
from zhutong.storage.backup import create_backup, restore_backup, verify_backup


def tables(path: Path) -> dict:
    with closing(sqlite3.connect(path)) as db:
        names = [
            row[0]
            for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]
        data = {}
        for name in names:
            rows = db.execute(
                'SELECT * FROM "' + name.replace('"', '""') + '" ORDER BY rowid'
            ).fetchall()
            raw = json.dumps(rows, ensure_ascii=False, default=lambda value: value.hex()).encode()
            data[name] = {"count": len(rows), "sha256": hashlib.sha256(raw).hexdigest()}
    return data


def verify(runtime: Path) -> dict:
    suffix = uuid4().hex[:8]
    backup = runtime.parent / (runtime.name + "-backup-" + suffix)
    restored = runtime.parent / (runtime.name + "-restored-" + suffix)
    settings = Settings(
        runtime_dir=runtime, database_url=f"sqlite:///{(runtime / 'zhutong.sqlite').as_posix()}"
    )
    manifest = create_backup(settings, backup)
    verify_backup(backup)
    restore_backup(backup, restored)
    original = tables(backup / "zhutong.sqlite")
    recovered = tables(restored / "zhutong.sqlite")
    assert original == recovered
    return {
        "backup": str(backup),
        "restored": str(restored),
        "schemaRevision": manifest["schemaRevision"],
        "tables": original,
        "allTableContentsEqual": True,
        "modelFiles": {key: manifest["files"][key] for key in manifest.get("modelFiles", [])},
        "allFilesVerified": True,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.runtime.resolve())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {key: value for key, value in result.items() if key not in {"tables", "modelFiles"}}
        )
    )
