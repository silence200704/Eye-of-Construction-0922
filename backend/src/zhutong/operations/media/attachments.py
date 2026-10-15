from ...core.errors import AppError
from .access import require_dataset, require_file, require_scope
from .types import AttachmentSpec, MediaContext, MediaRepository


def owner_field(spec: AttachmentSpec) -> tuple[str, str]:
    owners = [
        (field, value)
        for field in ("issue_id", "work_order_id", "maintenance_task_id")
        if (value := getattr(spec, field)) is not None
    ]
    if len(owners) != 1:
        raise AppError("VALIDATION_FAILED", "照片必须且只能关联一个问题、工单或保养任务", 422)
    return owners[0]


def link_attachment(
    repository: MediaRepository, context: MediaContext, spec: AttachmentSpec
) -> tuple[dict, bool]:
    owner_field(spec)
    with repository.write():
        require_dataset(repository, context.dataset_id)
        photo = require_file(repository, context, spec.media_id)
        owner = repository.owner(context.dataset_id, spec)
        if owner is None:
            raise AppError("NOT_FOUND", "照片归属对象不存在", 404)
        require_scope(context, owner.building_id)
        if photo.point_id and owner.point_id and photo.point_id != owner.point_id:
            raise AppError("STATE_CONFLICT", "照片关联测点与归属对象不一致", 409)
        if not photo.mime_type.startswith("image/"):
            raise AppError("VALIDATION_FAILED", "业务照片附件必须是图片", 422)
        if photo.uploaded_by != context.actor.id and context.actor.role != "safety":
            raise AppError("ROLE_FORBIDDEN", "只能关联本人上传的媒体", 403)
        if spec.kind == "acceptance" and context.actor.role != "safety":
            raise AppError("ROLE_FORBIDDEN", "仅安全管理人员可添加验收照片", 403)
        if spec.thumb_id:
            thumb = require_file(repository, context, spec.thumb_id)
            if not thumb.mime_type.startswith("image/") or thumb.uploaded_by != photo.uploaded_by:
                raise AppError("VALIDATION_FAILED", "缩略图必须是同一上传人的图片", 422)
        existing = repository.attachment(context.dataset_id, spec.draft_id)
        if existing:
            if any(existing[key] != value for key, value in attachment_fields(spec).items()):
                raise AppError("IDEMPOTENCY_CONFLICT", "此照片草稿标识已关联其他内容", 409)
            return existing, True
        if repository.media_attached(context.dataset_id, spec.media_id):
            raise AppError("STATE_CONFLICT", "此照片已关联业务对象，请复用原关联", 409)
        count, size = repository.owner_totals(context.dataset_id, spec)
        if count >= 3 or size + photo.size > 600 * 1024:
            raise AppError("ATTACHMENT_LIMIT", "每个对象最多三张照片且总计不超过 600 KB", 422)
        return repository.save_attachment(context, spec), False


def attachment_fields(spec: AttachmentSpec) -> dict:
    return {
        "mediaId": spec.media_id,
        "thumbId": spec.thumb_id,
        "issueId": spec.issue_id,
        "workOrderId": spec.work_order_id,
        "maintenanceTaskId": spec.maintenance_task_id,
        "kind": spec.kind,
        "draftId": spec.draft_id,
    }
