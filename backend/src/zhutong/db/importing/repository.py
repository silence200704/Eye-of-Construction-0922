import copy

from sqlalchemy import func, insert, select, text
from sqlalchemy.exc import IntegrityError

from ...core.errors import AppError
from ...operations.importing.links import validate_links
from ...operations.importing.prepare import digest, problem
from ...operations.importing.types import ImportContext, ImportPlan
from ..models.foundation import Dataset, ImportBatch, Preference, SessionState
from ..models.monitoring import RuleDefinition
from .binary_rows import copy_binary_rows
from .catalog import CATALOG
from .mapping import equivalent, values_for
from .runtime import save_runtime


class SqlImportRepository:
    def __init__(self, session: object) -> None:
        self.db = session
        self.retained_keys = []

    def execute(self, context: ImportContext, plan: ImportPlan, commit: bool) -> dict:
        report = copy.deepcopy(plan.report)
        report["datasetId"] = context.dataset_id
        with self.db.begin() as transaction:
            self.db.execute(text("BEGIN IMMEDIATE"))
            self.db.execute(text("PRAGMA defer_foreign_keys=ON"))
            dataset = self.db.get(Dataset, context.dataset_id)
            if dataset is None or not dataset.enabled:
                raise AppError("NOT_FOUND", "测试数据集不存在或已停用", 404)
            if context.expected_epoch is not None and dataset.epoch != context.expected_epoch:
                raise AppError("DATASET_EPOCH_CONFLICT", "数据集已变更，请重新预检", 409)
            previous = self.db.get(ImportBatch, (context.dataset_id, plan.source_hash))
            if previous:
                replay = copy.deepcopy(previous.report)
                replay["replayed"] = True
                for counts in replay["tables"].values():
                    counts.update(inserted=0, matched=counts["source"])
                return replay
            self.copy_rows(context, plan, report)
            copy_binary_rows(self, context, plan, report)
            if not report["errors"]:
                try:
                    save_runtime(self.db, context, plan)
                    validate_links(
                        plan.data,
                        lambda table, identifier: self.lookup(context, table, identifier),
                        report["errors"],
                    )
                    self.check_references(report)
                except (ValueError, KeyError, TypeError) as error:
                    report["errors"].append(problem("runtime", "", str(error)))
            report["valid"] = not report["errors"]
            if commit and report["valid"]:
                self.db.add(
                    ImportBatch(
                        dataset_id=context.dataset_id,
                        id=plan.source_hash,
                        source_hash=plan.source_hash,
                        source_name=plan.source_name,
                        imported_by=context.actor.id,
                        report=report,
                    )
                )
            else:
                transaction.rollback()
        return report

    def lookup(self, context: ImportContext, table: str, identifier: str) -> dict | None:
        row = self.db.get(CATALOG[table], (context.dataset_id, identifier))
        return row.legacy_payload if row else None

    def copy_rows(self, context: ImportContext, plan: ImportPlan, report: dict) -> None:
        self.copy_rules(context, plan, report)
        for table, model in CATALOG.items():
            if table == "attachments":
                continue
            for raw in plan.data[table]:
                try:
                    values = values_for(model, raw, context)
                    row = self.db.get(model, (context.dataset_id, raw["id"]))
                    if row:
                        if not equivalent(row, values):
                            raise ValueError("相同旧编号对应不同内容，不能覆盖")
                        report["tables"][table]["matched"] += 1
                    else:
                        with self.db.begin_nested():
                            self.db.execute(insert(model), values)
                        report["tables"][table]["inserted"] += 1
                    stored = self.db.get(model, (context.dataset_id, raw["id"]))
                    if digest(stored.legacy_payload) != digest(raw):
                        raise ValueError("原始字段核对失败")
                    report["fieldsVerified"] += len(raw)
                except (KeyError, TypeError, ValueError, IntegrityError) as error:
                    message = str(error.orig) if isinstance(error, IntegrityError) else str(error)
                    report["errors"].append(problem(table, raw["id"], message))

    def copy_rules(self, context: ImportContext, plan: ImportPlan, report: dict) -> None:
        for rule in plan.data["rules"]:
            identifier = rule.get("ruleId", rule.get("code"))
            if not identifier:
                report["errors"].append(problem("rules", rule["id"], "缺少稳定规则标识"))
                continue
            if self.db.get(RuleDefinition, (context.dataset_id, identifier)) is None:
                self.db.execute(
                    insert(RuleDefinition),
                    {"dataset_id": context.dataset_id, "id": identifier, "code": rule["code"]},
                )

    def check_references(self, report: dict) -> None:
        for table, rowid, parent, _ in self.db.execute(text("PRAGMA foreign_key_check")):
            identifier = self.db.execute(
                text(f'SELECT id FROM "{table}" WHERE rowid=:rowid'), {"rowid": rowid}
            ).scalar()
            report["errors"].append(
                problem(table, identifier or "", f"引用的 {parent} 对象不存在或不属于本数据集")
            )

    def snapshot(self, dataset_id: str) -> dict:
        if self.db.get(Dataset, dataset_id) is None:
            raise AppError("NOT_FOUND", "数据集不存在", 404)
        data = {
            name: [
                row.legacy_payload
                for row in self.db.scalars(select(model).where(model.dataset_id == dataset_id))
                if row.legacy_payload
            ]
            for name, model in CATALOG.items()
        }
        counts = {
            model.__tablename__: self.db.scalar(
                select(func.count()).select_from(model).where(model.dataset_id == dataset_id)
            )
            for model in (Preference, SessionState)
        }
        return {"data": data, "runtimeCounts": counts}

    def history(self, dataset_id: str) -> list[dict]:
        rows = self.db.scalars(
            select(ImportBatch)
            .where(ImportBatch.dataset_id == dataset_id)
            .order_by(ImportBatch.imported_at.desc())
        )
        return [row.report for row in rows]
