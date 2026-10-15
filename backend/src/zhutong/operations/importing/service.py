from ..media.types import BinaryStore
from .files import prepare_files
from .prepare import prepare
from .types import ImportContext, ImportRepository


async def import_legacy(
    repository: ImportRepository,
    store: BinaryStore,
    context: ImportContext,
    payload: dict,
    commit: bool,
) -> dict:
    plan = prepare(payload)
    report = plan.report
    keep = set()
    try:
        if report["valid"]:
            await prepare_files(store, context, plan)
            report["valid"] = not report["errors"]
        if report["valid"]:
            report = repository.execute(context, plan, commit)
            if commit and report["valid"] and not report.get("replayed"):
                keep.update(repository.retained_keys)
        return report
    finally:
        for key in plan.file_keys:
            if key not in keep:
                store.remove(key)
