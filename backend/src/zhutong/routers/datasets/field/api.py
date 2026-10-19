"""阶段 5：巡检、问题、工单、保养与附件路由。"""

from fastapi import APIRouter, Request

from ....operations.datasets.core.workspace import Command, execute_command
from ....operations.field import inspection, issues, maintenance, orders, reviews, task_checks
from ..common import Current, Read, Write, reply
from .schemas import (
    CheckInInput,
    CompleteInput,
    EnabledInput,
    GenerateInput,
    IssueInput,
    MaintenanceExecuteInput,
    MaintenancePlanInput,
    ManualOrderInput,
    OrderActionInput,
    OutcomeInput,
    PlanInput,
    RecheckInput,
    ReviewInput,
    TaskIssueInput,
)

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}", tags=["现场业务"])


@router.get("/inspection/plans")
def inspection_plans(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, inspection.list_plans(session, current))


@router.post("/inspection/plans")
def create_inspection_plan(
    request: Request, session: Write, current: Current, body: PlanInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "inspection_plan_write", payload),
        lambda: inspection.save_plan(session, current, payload, None, None),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.patch("/inspection/plans/{plan_id}")
def update_inspection_plan(
    request: Request, session: Write, current: Current, plan_id: str, body: PlanInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "inspection_plan_write", payload),
        lambda: inspection.save_plan(session, current, payload, plan_id, body.expectedRev),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.post("/inspection/plans/{plan_id}/enabled")
def enabled_inspection_plan(
    request: Request, session: Write, current: Current, plan_id: str, body: EnabledInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "inspection_plan_enabled", payload),
        lambda: inspection.set_plan_enabled(
            session, current, plan_id, body.enabled, body.expectedRev
        ),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.get("/inspection/tasks")
def inspection_tasks(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, task_checks.list_tasks(session, current))


@router.post("/inspection/tasks/generate")
def generate_tasks(request: Request, session: Write, current: Current, body: GenerateInput) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "inspection_task_generate", payload),
        lambda: inspection.generate_tasks(session, current, body.date),
    )
    return reply(request, current, data, None, replayed)


@router.post("/inspection/tasks/{task_id}/check-in")
def task_check_in(
    request: Request, session: Write, current: Current, task_id: str, body: CheckInInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "inspection_check_in", payload),
        lambda: task_checks.check_in(session, current, task_id, payload),
    )
    return reply(request, current, data, data["task"]["rev"], replayed)


@router.post("/inspection/tasks/{task_id}/complete-point")
def task_complete(
    request: Request, session: Write, current: Current, task_id: str, body: CompleteInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "inspection_complete", payload),
        lambda: task_checks.complete_point(session, current, task_id, payload),
    )
    return reply(request, current, data, data["task"]["rev"], replayed)


@router.post("/inspection/tasks/{task_id}/issues")
def task_issue(
    request: Request, session: Write, current: Current, task_id: str, body: TaskIssueInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "inspection_issue", payload),
        lambda: task_checks.report_task_issue(session, current, task_id, payload),
    )
    return reply(request, current, data, data["issue"]["rev"], replayed)


@router.get("/issues")
def issue_list(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, issues.list_issues(session, current))


@router.post("/issues")
def issue_report(request: Request, session: Write, current: Current, body: IssueInput) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "issue_report", payload),
        lambda: issues.report_issue(session, current, payload),
    )
    return reply(request, current, data, data["issue"]["rev"], replayed)


@router.post("/issues/{issue_id}/review")
def issue_review(
    request: Request, session: Write, current: Current, issue_id: str, body: ReviewInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "issue_review", payload),
        lambda: reviews.review_issue(session, current, issue_id, payload),
    )
    return reply(request, current, data, data["issue"]["rev"], replayed)


@router.post("/issues/{issue_id}/rechecks")
def recheck_register(
    request: Request, session: Write, current: Current, issue_id: str, body: RecheckInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "issue_recheck_register", payload),
        lambda: reviews.register_recheck(session, current, issue_id, payload),
    )
    return reply(request, current, data, data["issue"]["rev"], replayed)


@router.post("/issues/{issue_id}/rechecks/outcome")
def recheck_outcome(
    request: Request, session: Write, current: Current, issue_id: str, body: OutcomeInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "issue_recheck_outcome", payload),
        lambda: reviews.record_recheck(session, current, issue_id, payload),
    )
    return reply(request, current, data, data["issue"]["rev"], replayed)


@router.get("/work-orders")
def order_list(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, orders.list_orders(session, current))


@router.post("/work-orders")
def order_create(
    request: Request, session: Write, current: Current, body: ManualOrderInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "work_order_create", payload),
        lambda: orders.create_manual(session, current, payload),
    )
    return reply(request, current, data, data["order"]["rev"], replayed)


@router.post("/work-orders/{order_id}/actions")
def order_action(
    request: Request, session: Write, current: Current, order_id: str, body: OrderActionInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "work_order_action", payload),
        lambda: orders.advance_order(session, current, order_id, payload),
    )
    return reply(request, current, data, data["order"]["rev"], replayed)


@router.get("/maintenance/plans")
def maintenance_plans(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, maintenance.list_plans(session, current))


@router.post("/maintenance/plans")
def create_maintenance_plan(
    request: Request, session: Write, current: Current, body: MaintenancePlanInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "maintenance_plan_write", payload),
        lambda: maintenance.save_plan(session, current, payload, None, None),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.patch("/maintenance/plans/{plan_id}")
def update_maintenance_plan(
    request: Request, session: Write, current: Current, plan_id: str, body: MaintenancePlanInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "maintenance_plan_write", payload),
        lambda: maintenance.save_plan(session, current, payload, plan_id, body.expectedRev),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.post("/maintenance/plans/{plan_id}/enabled")
def maintenance_plan_enabled(
    request: Request, session: Write, current: Current, plan_id: str, body: EnabledInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "maintenance_plan_enabled", payload),
        lambda: maintenance.set_enabled(session, current, plan_id, body.enabled, body.expectedRev),
    )
    return reply(request, current, data, data.get("rev"), replayed)


@router.get("/maintenance/tasks")
def maintenance_tasks(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, maintenance.list_tasks(session, current))


@router.post("/maintenance/tasks/generate")
def generate_maintenance(
    request: Request, session: Write, current: Current, body: GenerateInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "maintenance_generate", payload),
        lambda: maintenance.generate(session, current, body.date),
    )
    return reply(request, current, data, None, replayed)


@router.post("/maintenance/tasks/{task_id}/execute")
def execute_maintenance(
    request: Request, session: Write, current: Current, task_id: str, body: MaintenanceExecuteInput
) -> dict:
    payload = body.model_dump()
    data, replayed = execute_command(
        session,
        current,
        Command(request, "maintenance_execute", payload),
        lambda: maintenance.execute(session, current, task_id, payload),
    )
    return reply(request, current, data, data["task"]["rev"], replayed)


@router.get("/attachments")
def attachments(request: Request, session: Read, current: Current) -> dict:
    return reply(request, current, issues.list_attachments(session, current))
