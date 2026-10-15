from ...core.errors import AppError
from .types import MediaContext, MediaRecord, MediaRepository


def require_dataset(repository: MediaRepository, dataset_id: str) -> None:
    if not repository.dataset_exists(dataset_id):
        raise AppError("NOT_FOUND", "测试数据集不存在或已停用", 404)


def require_scope(context: MediaContext, building_id: str | None) -> None:
    allowed = context.actor.building_ids
    if allowed is not None and building_id not in allowed:
        raise AppError("SCOPE_FORBIDDEN", "当前身份不在此楼栋操作范围内", 403)


def require_file(repository: MediaRepository, context: MediaContext, file_id: str) -> MediaRecord:
    record = repository.get_file(context.dataset_id, file_id)
    if record is None:
        raise AppError("NOT_FOUND", "媒体文件不存在", 404)
    if record.point_id:
        require_scope(context, repository.point_building(context.dataset_id, record.point_id))
    elif record.uploaded_by != context.actor.id and context.actor.role != "safety":
        raise AppError("ROLE_FORBIDDEN", "未关联测点的媒体仅上传人或安全管理人员可读取", 403)
    return record
