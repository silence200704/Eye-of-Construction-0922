"""共享文件指纹；避免备份清单与模型清单互相依赖。"""

import hashlib
from pathlib import Path


def fingerprint(path: Path) -> dict:
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    return {"size": path.stat().st_size, "sha256": digest}
