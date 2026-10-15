import hashlib
import os
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from ..core.errors import AppError
from ..operations.media.types import MediaRecord, StoredFile
from .validation import inspect_media


def safe_child(root: Path, key: str) -> Path:
    resolved = (root / key).resolve()
    if not resolved.is_relative_to(root.resolve()) or resolved == root.resolve():
        raise AppError("INVALID_MEDIA_PATH", "媒体路径无效", 422)
    return resolved


class FileStore:
    def __init__(self, root: Path, max_bytes: int) -> None:
        self.root = root
        self.max_bytes = max_bytes

    async def put(self, source: AsyncIterator[bytes], mime_type: str) -> StoredFile:
        identifier = uuid.uuid4().hex
        temporary = safe_child(self.root, f".staging/{identifier}.part")
        temporary.parent.mkdir(parents=True, exist_ok=True)
        size, digest = 0, hashlib.sha256()
        try:
            with temporary.open("xb") as target:
                async for chunk in source:
                    size += len(chunk)
                    if size > self.max_bytes:
                        raise AppError("MEDIA_TOO_LARGE", "文件超过上传体积限制", 413)
                    digest.update(chunk)
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
            width, height = inspect_media(temporary, mime_type)
            key = f"files/{identifier[:2]}/{identifier}"
            destination = safe_child(self.root, key)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(temporary, destination)
            return StoredFile(identifier, key, mime_type, size, digest.hexdigest(), width, height)
        finally:
            temporary.unlink(missing_ok=True)

    def remove(self, key: str) -> None:
        safe_child(self.root, key).unlink(missing_ok=True)

    def checked_path(self, record: MediaRecord) -> str:
        path = safe_child(self.root, record.storage_key)
        if not path.is_file():
            raise AppError("MEDIA_MISSING", "媒体元数据存在，但原文件缺失", 404)
        with path.open("rb") as source:
            actual = hashlib.file_digest(source, "sha256").hexdigest()
        if path.stat().st_size != record.size or actual != record.sha256:
            raise AppError("MEDIA_CORRUPT", "媒体文件完整性校验失败", 409)
        return str(path)
