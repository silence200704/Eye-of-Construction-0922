from dataclasses import dataclass, field
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
    binary_rows: list[tuple[str, dict]] = field(default_factory=list)
    file_keys: list[str] = field(default_factory=list)


class ImportRepository(Protocol):
    retained_keys: list[str]

    def execute(self, context: ImportContext, plan: ImportPlan, commit: bool) -> dict: ...
    def snapshot(self, dataset_id: str) -> dict: ...
