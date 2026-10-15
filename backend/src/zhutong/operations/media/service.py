from collections.abc import AsyncIterator
from dataclasses import asdict
from datetime import UTC, datetime

from ...core.errors import AppError
from .access import require_dataset, require_file, require_scope
from .types import BinaryStore, MediaContext, MediaRecord, MediaRepository, UploadSpec


def same_upload(record: MediaRecord, candidate: MediaRecord) -> bool:
    ignored = {"id", "storage_key", "uploaded_at"}
    return all(
        value == asdict(candidate)[key]
        for key, value in asdict(record).items()
        if key not in ignored
    )


class MediaService:
    def __init__(self, repository: MediaRepository, binaries: BinaryStore) -> None:
        self.repository = repository
        self.binaries = binaries

    async def upload(
        self, context: MediaContext, spec: UploadSpec, source: AsyncIterator[bytes]
    ) -> tuple[MediaRecord, bool]:
        stored = await self.binaries.put(source, spec.mime_type)
        candidate = MediaRecord(
            **asdict(stored),
            dataset_id=context.dataset_id,
            file_name=spec.file_name,
            point_id=spec.point_id,
            origin=spec.origin,
            draft_key=spec.draft_key,
            captured_at=spec.captured_at,
            uploaded_at=datetime.now(UTC).isoformat(),
            uploaded_by=context.actor.id,
        )
        try:
            with self.repository.write():
                require_dataset(self.repository, context.dataset_id)
                if spec.point_id:
                    building = self.repository.point_building(context.dataset_id, spec.point_id)
                    if building is None:
                        raise AppError("NOT_FOUND", "关联测点不存在", 404)
                    require_scope(context, building)
                existing = (
                    self.repository.by_draft(context, spec.draft_key) if spec.draft_key else None
                )
                if existing:
                    if not same_upload(existing, candidate):
                        raise AppError(
                            "IDEMPOTENCY_CONFLICT", "此上传标识已用于不同文件或元数据", 409
                        )
                    self.binaries.remove(stored.storage_key)
                    return existing, True
                self.repository.save_file(context, candidate)
        except BaseException:
            self.binaries.remove(stored.storage_key)
            raise
        return candidate, False

    def read(self, context: MediaContext, file_id: str) -> MediaRecord:
        require_dataset(self.repository, context.dataset_id)
        return require_file(self.repository, context, file_id)
