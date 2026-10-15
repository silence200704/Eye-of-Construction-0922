from dataclasses import dataclass
from typing import Protocol

from ..identity_types import Account


@dataclass(frozen=True)
class ImportContext:
    dataset_id: str
    actor: Account
    expected_epoch: int | None = None


@dataclass
class ImportPlan:
    source_name: str
    source_hash: str
    data: dict
    runtime: dict
    report: dict


class ImportRepository(Protocol):
    def execute(self, context: ImportContext, plan: ImportPlan, commit: bool) -> dict: ...
    def snapshot(self, dataset_id: str) -> dict: ...
