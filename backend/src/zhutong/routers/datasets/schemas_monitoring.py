"""监测、事件与通知命令 DTO。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RecordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pointId: str = Field(min_length=1)
    deviceId: str | None = None
    values: dict[str, float]
    unit: str
    sampleTime: str = Field(min_length=1)
    sampleWindow: str = ""
    source: Literal["manual", "device", "csv"] = "manual"
    quality: Literal["valid", "suspect", "invalid"] = "valid"
    qualityNote: str = ""
    note: str = ""


class RevisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    values: dict[str, float]
    unit: str
    sampleTime: str = Field(min_length=1)
    sampleWindow: str = ""
    source: Literal["manual", "device", "csv"] = "manual"
    quality: Literal["valid", "suspect", "invalid"] = "valid"
    qualityNote: str = ""
    note: str = ""
    deviceId: str | None = None
    reason: str = ""


class AssessmentPreviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pointId: str = Field(min_length=1)
    deviceId: str | None = None
    values: dict[str, float]
    unit: str
    sampleTime: str = Field(min_length=1)
    sampleWindow: str = ""
    quality: Literal["valid", "suspect", "invalid"] = "valid"
    recordId: str | None = None


class ImportPreviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    csvText: str = Field(min_length=1)


class ImportCommitInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    csvText: str = Field(min_length=1)
    token: str = Field(min_length=1)
    lineNos: list[int] | None = None
    fileName: str = ""


class EventCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None


class EventCloseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    basis: str = ""
    noRepairNote: str = ""
