"""阶段 7 小瞳问答与会话 DTO。"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class QueryContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pointId: str | None = None
    eventId: str | None = None
    issueId: str | None = None
    workOrderId: str | None = None
    pointIds: list[str] = Field(default_factory=list)
    caseIds: list[str] = Field(default_factory=list)
    replayNode: str | None = None
    videoId: str | None = None
    simulation: dict[str, float] | None = None
    source: Literal["page", "previous", "explicit"] = "page"


class AssistantQueryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=500)
    sessionId: str | None = None
    context: QueryContext = Field(default_factory=QueryContext)


class MediaFrameInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mediaId: str = Field(min_length=1)
    pointId: str = Field(min_length=1)
    label: str = ""
    capturedAt: str | None = None
    timeCode: float | None = None


class MediaCompareInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pointId: str = Field(min_length=1)
    beforeId: str = Field(min_length=1)
    afterId: str = Field(min_length=1)
    result: dict[str, Any]
