import { Building, Floor, Point, Device, MonitorRecord, AlarmEvent } from './Monitoring';
import { InspectionTask, WorkOrder } from './Tasks';
import { IssueRecord } from './Reports';

export interface ArchiveSnapshot {
  epoch: number;
  buildings: Building[];
  floors: Floor[];
  points: Point[];
  devices: Device[];
}

export interface Workspace extends ArchiveSnapshot {
  records: MonitorRecord[];
  events: AlarmEvent[];
  tasks: InspectionTask[];
  orders: WorkOrder[];
  issues: IssueRecord[];
  supplementableIds: string[];
}

export function emptyWorkspace(): Workspace {
  return { epoch: 0, buildings: [], floors: [], points: [], devices: [], records: [], events: [], tasks: [], orders: [], issues: [], supplementableIds: [] };
}

export function withTasks(workspace: Workspace, tasks: InspectionTask[]): Workspace {
  return { epoch: workspace.epoch, buildings: workspace.buildings, floors: workspace.floors,
    points: workspace.points, devices: workspace.devices, records: workspace.records,
    events: workspace.events, orders: workspace.orders, issues: workspace.issues, supplementableIds: workspace.supplementableIds, tasks };
}

export function withIssues(workspace: Workspace, issues: IssueRecord[]): Workspace {
  return { epoch: workspace.epoch, buildings: workspace.buildings, floors: workspace.floors,
    points: workspace.points, devices: workspace.devices, records: workspace.records,
    events: workspace.events, orders: workspace.orders, tasks: workspace.tasks, supplementableIds: workspace.supplementableIds, issues };
}

export function withOrders(workspace: Workspace, orders: WorkOrder[]): Workspace {
  return { epoch: workspace.epoch, buildings: workspace.buildings, floors: workspace.floors,
    points: workspace.points, devices: workspace.devices, records: workspace.records,
    events: workspace.events, tasks: workspace.tasks, issues: workspace.issues, supplementableIds: workspace.supplementableIds, orders };
}

export function withEvents(workspace: Workspace, events: AlarmEvent[]): Workspace {
  return { epoch: workspace.epoch, buildings: workspace.buildings, floors: workspace.floors,
    points: workspace.points, devices: workspace.devices, records: workspace.records,
    tasks: workspace.tasks, orders: workspace.orders, issues: workspace.issues, supplementableIds: workspace.supplementableIds, events };
}
