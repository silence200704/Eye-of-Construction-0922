from collections.abc import AsyncIterator
from contextlib import AbstractContextManager
from dataclasses import asdict, dataclass
from typing import Protocol

from ..identity_types import Account


@dataclass(frozen=True)
class MediaRecord:
    dataset_id: str
    id: str
    file_name: str
    mime_type: str
    size: int
    sha256: str
    storage_key: str
    width: int
    height: int
    point_id: str | None
    origin: str
    draft_key: str | None
    captured_at: str | None
    uploaded_at: str
    uploaded_by: str

    def public(self) -> dict:
        fields = asdict(self)
        aliases = {
            "file_name": "fileName",
            "mime_type": "mimeType",
            "point_id": "pointId",
            "captured_at": "capturedAt",
            "uploaded_at": "uploadedAt",
            "uploaded_by": "uploadedBy",
        }
        result = {
            aliases.get(key, key): value
            for key, value in fields.items()
            if key not in {"storage_key", "draft_key", "dataset_id"}
        }
        result["contentUrl"] = f"/api/v1/datasets/{self.dataset_id}/media/{self.id}/content"
        return result


@dataclass(frozen=True)
class StoredFile:
    id: str
    storage_key: str
    mime_type: str
    size: int
    sha256: str
    width: int
    height: int


@dataclass(frozen=True)
class MediaContext:
    dataset_id: str
    actor: Account


@dataclass(frozen=True)
class UploadSpec:
    file_name: str
    mime_type: str
    point_id: str | None = None
    origin: str = "upload"
    draft_key: str | None = None
    captured_at: str | None = None


@dataclass(frozen=True)
class AttachmentSpec:
    media_id: str
    draft_id: str
    kind: str
    thumb_id: str | None = None
    issue_id: str | None = None
    work_order_id: str | None = None
    maintenance_task_id: str | None = None


@dataclass(frozen=True)
class Owner:
    building_id: str | None
    point_id: str | None


class MediaRepository(Protocol):
    def write(self) -> AbstractContextManager: ...
    def dataset_exists(self, dataset_id: str) -> bool: ...
    def point_building(self, dataset_id: str, point_id: str) -> str | None: ...
    def get_file(self, dataset_id: str, file_id: str) -> MediaRecord | None: ...
    def by_draft(self, context: MediaContext, key: str) -> MediaRecord | None: ...
    def save_file(self, context: MediaContext, record: MediaRecord) -> None: ...
    def owner(self, dataset_id: str, spec: AttachmentSpec) -> Owner | None: ...
    def attachment(self, dataset_id: str, draft_id: str) -> dict | None: ...
    def media_attached(self, dataset_id: str, media_id: str) -> bool: ...
    def owner_totals(self, dataset_id: str, spec: AttachmentSpec) -> tuple[int, int]: ...
    def save_attachment(self, context: MediaContext, spec: AttachmentSpec) -> dict: ...


class BinaryStore(Protocol):
    async def put(self, source: AsyncIterator[bytes], mime_type: str) -> StoredFile: ...
    def remove(self, key: str) -> None: ...
    def checked_path(self, record: MediaRecord) -> str: ...
