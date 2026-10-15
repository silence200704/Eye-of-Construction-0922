from sqlalchemy import insert
from sqlalchemy.exc import IntegrityError

from ...operations.importing.prepare import problem
from ..models.media import Attachment, MediaComparison, MediaFile, MediaFrame, MediaVideo
from .mapping import equivalent

MODELS = {
    model.__tablename__: model
    for model in (MediaFile, Attachment, MediaVideo, MediaFrame, MediaComparison)
}


def copy_binary_rows(repository: object, context: object, plan: object, report: dict) -> None:
    for table, values in plan.binary_rows:
        model = MODELS[table]
        try:
            row = repository.db.get(model, (context.dataset_id, values["id"]))
            if row:
                if not equivalent(row, values):
                    raise ValueError("旧媒体编号对应不同内容，不能覆盖")
                mode = "matched"
            else:
                with repository.db.begin_nested():
                    repository.db.execute(insert(model), values)
                if table == "media_files":
                    repository.retained_keys.append(values["storage_key"])
                mode = "inserted"
            if table == "attachments":
                report["tables"][table][mode] += 1
                report["fieldsVerified"] += len(values["legacy_payload"])
        except (ValueError, IntegrityError) as error:
            message = str(error.orig) if isinstance(error, IntegrityError) else str(error)
            report["errors"].append(problem(table, values["id"], message))
