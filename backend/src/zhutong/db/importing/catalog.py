from ..models.archive import Building, Device, Floor, Point
from ..models.field import (
    InspectionPlan,
    InspectionTask,
    Issue,
    MaintenancePlan,
    MaintenanceTask,
    WorkOrder,
)
from ..models.foundation import AuditLog
from ..models.media import Attachment
from ..models.monitoring import (
    AlarmEvent,
    AlarmNotification,
    Baseline,
    MonitoringRule,
    MonitorRecord,
)

CATALOG = {
    "buildings": Building,
    "floors": Floor,
    "points": Point,
    "devices": Device,
    "baselines": Baseline,
    "records": MonitorRecord,
    "audits": AuditLog,
    "rules": MonitoringRule,
    "events": AlarmEvent,
    "notifications": AlarmNotification,
    "plans": InspectionPlan,
    "tasks": InspectionTask,
    "maintenancePlans": MaintenancePlan,
    "maintenanceTasks": MaintenanceTask,
    "issues": Issue,
    "workOrders": WorkOrder,
    "attachments": Attachment,
}
