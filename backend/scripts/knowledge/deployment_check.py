"""只读交付核验：迁移前快照与当前业务内容、媒体哈希及端口并存。"""

import argparse
import json
import subprocess
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[3]
QUERY = r"""
import hashlib,json,sqlite3
from pathlib import Path
def inspect(path):
    with sqlite3.connect(path) as db:
        query="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        names=[r[0] for r in db.execute(query)]
        data={}
        for name in names:
            if name in ('users','login_sessions'): continue
            rows=db.execute('SELECT * FROM "'+name.replace('"','""')+'" ORDER BY rowid').fetchall()
            raw=json.dumps(rows,ensure_ascii=False,default=lambda b:b.hex()).encode()
            data[name]={'count':len(rows),'sha256':hashlib.sha256(raw).hexdigest()}
    return data
def files(root):
    return {str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}
def retained():
    with sqlite3.connect('/data/backups/before-stage6-7237e55a/zhutong.sqlite') as old:
        with sqlite3.connect('/data/zhutong.sqlite') as current:
            return {name: all(row in current.execute('SELECT * FROM '+name).fetchall()
                             for row in old.execute('SELECT * FROM '+name).fetchall())
                    for name in ('audits','operation_receipts')}
print(json.dumps({'before':inspect('/data/backups/before-stage6-7237e55a/zhutong.sqlite'),
 'current':inspect('/data/zhutong.sqlite'),
 'mediaBefore':files(Path('/data/backups/before-stage6-7237e55a/media')),
 'mediaCurrent':files(Path('/data/media')), 'originalHistoryRetained':retained()}))
"""


def check() -> dict:
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            "deploy/compose.yaml",
            "exec",
            "-T",
            "api",
            "/app/.venv/bin/python",
            "-",
        ],
        input=QUERY,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(result.stdout)
    excluded = {"alembic_version", "audits", "operation_receipts"}
    unchanged = {
        key: value == data["current"][key]
        for key, value in data["before"].items()
        if key not in excluded
    }
    with httpx.Client(trust_env=False, timeout=10) as client:
        endpoints = {
            url: client.get(url).status_code
            for url in (
                "http://127.0.0.1:8000/health/ready",
                "http://127.0.0.1:5173/",
                "http://127.0.0.1:18000/api/v1/health/ready",
                "http://127.0.0.1:8080/",
                "http://127.0.0.1:5180/",
            )
        }
    data.update(
        {
            "businessTablesUnchanged": unchanged,
            "allBusinessUnchanged": all(unchanged.values()),
            "allMediaUnchanged": data["mediaBefore"] == data["mediaCurrent"],
            "endpoints": endpoints,
        }
    )
    assert data["allBusinessUnchanged"] and data["allMediaUnchanged"]
    assert all(data["originalHistoryRetained"].values())
    assert all(code == 200 for code in endpoints.values())
    return data


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = check()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {key: result[key] for key in ("allBusinessUnchanged", "allMediaUnchanged", "endpoints")}
        )
    )
