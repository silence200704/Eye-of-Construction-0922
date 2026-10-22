from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["safety", "property", "device", "inspector", "repair"]


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class DocumentInput(StrictInput):
    title: str = Field(min_length=1, max_length=120)
    sourcePath: str = Field(min_length=1, max_length=500)
    sourceKind: Literal["project", "demo", "reference"] = "project"
    content: str = Field(min_length=1, max_length=40000)
    roles: list[Role] = Field(
        default_factory=lambda: ["safety", "property", "device", "inspector", "repair"],
        min_length=1,
    )


class VersionInput(StrictInput):
    expectedRev: int = Field(ge=1)
    content: str = Field(min_length=1, max_length=40000)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    roles: list[Role] | None = Field(default=None, min_length=1)


class EnabledInput(StrictInput):
    expectedRev: int = Field(ge=1)
    enabled: bool


class FAQInput(StrictInput):
    id: str | None = None
    expectedRev: int | None = Field(default=None, ge=1)
    chunkId: str = Field(min_length=1)
    questions: list[str] = Field(min_length=1, max_length=20)
    enabled: bool = True


class SynonymInput(StrictInput):
    id: str | None = None
    expectedRev: int | None = Field(default=None, ge=1)
    canonical: str = Field(min_length=1, max_length=40)
    aliases: list[str] = Field(min_length=1, max_length=20)
    enabled: bool = True


class SearchInput(StrictInput):
    query: str = Field(min_length=1, max_length=500)
    topK: int = Field(default=3, ge=1, le=10)


class EmptyInput(StrictInput):
    pass
