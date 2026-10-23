"""备份固定模型目录及完整文件清单；不跟随目录外文件。"""

import json
import shutil
from pathlib import Path

from .integrity import fingerprint
from .files import safe_child

MODEL_PREFIX = "models/bge-small-zh-v1.5/"


def model_entries(runtime: Path) -> list[str]:
    manifest_path = runtime / MODEL_PREFIX / "manifest.json"
    if not manifest_path.exists():
        return []
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = [MODEL_PREFIX + "manifest.json"]
    for name, checksum in manifest["files"].items():
        if not name or Path(name).name != name or name == "manifest.json":
            raise ValueError("模型清单路径无效")
        key = MODEL_PREFIX + name
        if fingerprint(safe_child(runtime, key))["sha256"] != checksum:
            raise ValueError("模型文件哈希与模型清单不一致")
        entries.append(key)
    return entries


def copy_model(runtime: Path, staging: Path, manifest: dict) -> None:
    keys = model_entries(runtime)
    if not keys:
        return
    manifest["modelFiles"] = keys
    for key in keys:
        source = safe_child(runtime, key)
        target = safe_child(staging, key)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        manifest["files"][key] = fingerprint(target)
