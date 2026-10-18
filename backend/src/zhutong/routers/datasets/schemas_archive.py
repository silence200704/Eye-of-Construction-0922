"""档案写入 DTO；客户端只能提交业务字段，actor/scope 由服务端身份决定。"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class BuildingInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    purpose: str = ""
    buildYear: int | None = None
    floorCount: int | None = None
    area: float | None = None
    structureType: str = ""
    managerUnit: str = ""
    userUnit: str = ""
    owner: str = ""
    ownerPhone: str = ""
    backupPerson: str = ""
    source: str = ""
    footprint: dict[str, Any] = Field(default_factory=dict)
    dataSource: Literal["real", "demo"] = "demo"
    remark: str = ""


class FloorInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    buildingId: str = Field(min_length=1)
    floorNo: int
    name: str = Field(min_length=1, max_length=120)
    zones: list[str] = Field(default_factory=list)
    planVersion: int = Field(default=1, ge=1)
    remark: str = ""


class PointInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    buildingId: str = Field(min_length=1)
    floorId: str = Field(min_length=1)
    zoneId: str = ""
    type: Literal["crack", "tilt", "vibration", "temp_humidity", "manual_check"]
    coord: dict[str, float]
    planVersion: int = Field(default=1, ge=1)
    owner: str = ""
    backupPerson: str = ""
    installDate: str = ""
    dataSource: Literal["real", "demo"] = "demo"
    remark: str = ""
    nfcLabel: str = ""
    locationReason: str = ""


class DeviceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    pointId: str | None = None
    model: str = ""
    serial: str = ""
    rangeMin: float | None = None
    rangeMax: float | None = None
    unit: str = ""
    nodeId: str = ""
    gateway: str = ""
    mountPosition: str = ""
    direction: str = ""
    installDate: str = ""
    calibratedAt: str = ""
    health: Literal["unknown", "online", "offline"] = "unknown"
    remark: str = ""


class ArchiveInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["building", "floor", "point", "device"]
    expectedRev: int | None = None
    reason: str = ""


class BaselineInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pointId: str = Field(min_length=1)
    values: dict[str, float]
    unit: str = ""
    reason: str = ""
    effectiveFrom: str = ""
    expectedVersion: int | None = None


class RuleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedRev: int | None = None
    expectedVersion: str | None = None
    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    metric: Literal["crack_width", "tilt_xy", "vibration", "environment"]
    unit: str = ""
    enabled: bool = True
    buildingIds: list[str] = Field(default_factory=list)
    pointIds: list[str] = Field(default_factory=list)
    baselineSource: Literal["point", "fixed", "none"] = "point"
    fixedBaseline: dict[str, float] | None = None
    thresholds: dict[str, float] | None = None
    rateThreshold: float | None = None
    rateLevel: Literal["orange", "red"] = "orange"
    persistence: dict[str, Any]
    recovery: dict[str, Any]
    environment: dict[str, Any] | None = None
    source: str = ""
    confirmedBy: str = ""
    note: str = ""
    effectiveFrom: str = ""
