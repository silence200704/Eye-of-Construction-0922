"""阶段 5 写入 DTO。"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class PhotoInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mediaId: str = Field(min_length=1)
    draftId: str = Field(min_length=1)
    kind: Literal["scene", "before", "after", "acceptance"] = "scene"
    thumbId: str | None = None


class PlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    name: str = Field(min_length=1)
    kind: Literal["inspection", "patrol"] = "patrol"
    buildingId: str = Field(min_length=1)
    floorIds: list[str]
    pointIds: list[str]
    cycle: dict[str, Any]
    startDate: str
    endDate: str | None = None
    owner: str = ""
    executorRole: str
    checklist: list[dict[str, Any]]
    enabled: bool = True
    remark: str = ""


class EnabledInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    enabled: bool


class GenerateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: str = Field(min_length=10, max_length=10)


class CheckInInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    pointId: str = Field(min_length=1)
    method: Literal["nfc", "manual"] = "nfc"
    labelRead: str = ""
    fallbackReason: str = ""


class CompleteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    pointId: str = Field(min_length=1)
    answers: list[dict[str, Any]]
    linkedIssueId: str | None = None
    noIssueReason: str = ""


class TaskIssueInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    pointId: str = Field(min_length=1)
    anomalyType: str = Field(min_length=1)
    description: str = Field(min_length=1)
    submissionId: str = Field(min_length=1)
    photos: list[PhotoInput] = Field(default_factory=list)


class IssueInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source: Literal["report", "sensor"] = "report"
    pointId: str | None = None
    buildingId: str = Field(min_length=1)
    floorId: str = ""
    zoneId: str = ""
    anomalyType: str = Field(min_length=1)
    description: str = Field(min_length=1)
    submissionId: str = Field(min_length=1)
    eventId: str | None = None
    photos: list[PhotoInput] = Field(default_factory=list)


class ReviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    action: Literal[
        "to_repair",
        "to_investigate",
        "recheck",
        "need_evidence",
        "link_object",
        "close_no_fault",
    ]
    category: str
    note: str = ""
    duplicateOf: str | None = None
    linkedEventId: str | None = None
    photos: list[PhotoInput] = Field(default_factory=list)
    noPhotoReason: str = ""


class RecheckInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    subject: str
    owner: str
    dueDate: str


class OutcomeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    outcome: Literal["recovered", "observing", "recurred"]
    note: str
    nextDueDate: str | None = None


class OrderActionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    to: Literal["assigned", "repairing", "submitted", "verified", "returned"]
    note: str = ""
    assignee: str | None = None
    dueAt: str | None = None
    measures: str | None = None
    materials: str | None = None
    photos: list[PhotoInput] = Field(default_factory=list)


class ManualOrderInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pointId: str | None = None
    title: str = ""
    dueAt: str | None = None
    note: str = ""


class MaintenancePlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    name: str
    deviceId: str
    buildingId: str
    cycle: dict[str, Any]
    startDate: str
    endDate: str | None = None
    owner: str
    checklist: list[dict[str, Any]]
    enabled: bool = True
    remark: str = ""


class MaintenanceExecuteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    answers: list[dict[str, Any]]
    measures: str
    materials: str = ""
    nextDueDate: str
    note: str = ""
    abnormalNote: str = ""
    createIssue: bool = False
    photos: list[PhotoInput] = Field(default_factory=list)
