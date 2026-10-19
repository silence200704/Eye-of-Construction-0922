"""阶段 5 报表路由：指标、明细导出与单事件报告均从数据库读取。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from ....core.errors import AppError
from ....domain.inspection.schedule import valid_day
from ....operations.field import reports
from ..common import Current, Read, reply

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}", tags=["报表"])


def report_filters(
    start: str = "",
    end: str = "",
    buildingId: str = "",
    pointId: str = "",
    status: str = "",
) -> reports.ReportFilters:
    if (start and not valid_day(start)) or (end and not valid_day(end)):
        raise AppError("VALIDATION_FAILED", "时间范围日期不合法", 422)
    if start and end and start > end:
        raise AppError("VALIDATION_FAILED", "开始日期不能晚于结束日期", 422)
    return reports.ReportFilters(start, end, buildingId, pointId, status)


Filters = Annotated[reports.ReportFilters, Depends(report_filters)]


@router.get("/reports/indicators")
def report_indicators(request: Request, session: Read, current: Current, filters: Filters) -> dict:
    return reply(request, current, reports.indicators(session, current, filters))


@router.get("/reports/export")
def report_export(
    request: Request, session: Read, current: Current, kind: str, filters: Filters
) -> dict:
    data = reports.export_rows(session, current, kind, filters)
    return reply(request, current, data)


@router.get("/reports/events/{event_id}")
def report_event(request: Request, session: Read, current: Current, event_id: str) -> dict:
    return reply(request, current, reports.event_report(session, current, event_id))
