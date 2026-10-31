"""Read-only delivery database/media fingerprint; never outputs session secrets."""

import hashlib
import json
import sqlite3
from pathlib import Path

connection = sqlite3.connect("file:/data/zhutong.sqlite?mode=ro", uri=True)
connection.execute("BEGIN")
tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
result = {"datasets": {}, "media": {}}
for dataset in ("demo-main", "demo-showcase"):
    counts = {}
    for table in tables:
        columns = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
        if "dataset_id" in columns:
            counts[table] = connection.execute(
                f'SELECT COUNT(*) FROM "{table}" WHERE dataset_id=?', (dataset,)
            ).fetchone()[0]
    result["datasets"][dataset] = counts
result["migration"] = list(connection.execute("SELECT version_num FROM alembic_version"))[0][0]
connection.close()
media = Path("/data/media")
if media.exists():
    for path in sorted(media.rglob("*")):
        if path.is_file():
            result["media"][str(path.relative_to(media))] = hashlib.sha256(path.read_bytes()).hexdigest()
print(json.dumps(result, sort_keys=True))
