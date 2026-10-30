"""Bounded one-shot media hold for isolated acceptance; no HTTP control endpoint."""

import hashlib
import json
import re
import threading
import time
from pathlib import Path

_LOCK = threading.Lock()
_MEDIA = re.compile(r"/api/v1/datasets/demo-main/media/[A-Za-z0-9_-]+/content")


def _read(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path, value):
    pending = path.with_suffix(".tmp")
    pending.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    pending.replace(path)


def _take(runtime, path):
    if not _MEDIA.fullmatch(path):
        return None
    with _LOCK:
        marker, active = runtime / "hold-media.json", runtime / "active-media.json"
        if active.exists():
            return None
        request = _read(marker)
        seconds, gate_id = request.get("timeoutSeconds", 8), request.get("gateId")
        if (
            request.get("path") != path
            or not isinstance(gate_id, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", gate_id)
        ):
            return None
        if type(seconds) not in (int, float) or not 0 < seconds <= 8:
            return None
        marker.replace(active)
        return {"gateId": gate_id, "timeoutSeconds": seconds}


def hold_media(runtime: Path, path: str, data: bytes):
    request = _take(runtime, path)
    if request is None:
        return
    record = {
        **request,
        "path": path,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "outcome": "holding",
    }
    try:
        _write(runtime / "held-media.json", record)
        deadline = time.monotonic() + request["timeoutSeconds"]
        release = runtime / "release-media.json"
        while time.monotonic() < deadline:
            if _read(release).get("gateId") == request["gateId"]:
                release.unlink(missing_ok=True)
                record["outcome"] = "released"
                break
            time.sleep(0.02)
        else:
            record["outcome"] = "timeout"
        _write(runtime / "held-media.json", record)
    finally:
        (runtime / "active-media.json").unlink(missing_ok=True)
