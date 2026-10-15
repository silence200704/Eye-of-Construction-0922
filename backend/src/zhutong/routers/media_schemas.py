from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UploadQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fileName: str = Field(min_length=1, max_length=180)
    pointId: str | None = Field(default=None, min_length=1, max_length=160)
    origin: Literal["upload", "video_frame", "demo_generated", "demo_public", "demo_evidence"] = (
        "upload"
    )
    capturedAt: str | None = Field(default=None, max_length=80)

    @field_validator("fileName")
    @classmethod
    def valid_name(cls, value: str) -> str:
        if any(char in value for char in ("/", "\\", "\x00", "\r", "\n")):
            raise ValueError("文件名不能包含路径或控制字符")
        return value


class AttachmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mediaId: str = Field(min_length=1, max_length=160)
    draftId: str = Field(min_length=1, max_length=160)
    kind: Literal["scene", "before", "after", "acceptance"]
    thumbId: str | None = Field(default=None, min_length=1, max_length=160)
    issueId: str | None = Field(default=None, min_length=1, max_length=160)
    workOrderId: str | None = Field(default=None, min_length=1, max_length=160)
    maintenanceTaskId: str | None = Field(default=None, min_length=1, max_length=160)
