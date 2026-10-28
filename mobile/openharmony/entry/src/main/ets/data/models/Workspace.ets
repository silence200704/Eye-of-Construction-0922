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
}

export function emptyWorkspace(): Workspace {
  return { epoch: 0, buildings: [], floors: [], points: [], devices: [], records: [], events: [], tasks: [], orders: [], issues: [] };
}

export function withTasks(workspace: Workspace, tasks: InspectionTask[]): Workspace {
  return { epoch: workspace.epoch, buildings: workspace.buildings, floors: workspace.floors,
    points: workspace.points, devices: workspace.devices, records: workspace.records,
    events: workspace.events, orders: workspace.orders, issues: workspace.issues, tasks };
}

export function withIssues(workspace: Workspace, issues: IssueRecord[]): Workspace {
  return { epoch: workspace.epoch, buildings: workspace.buildings, floors: workspace.floors,
    points: workspace.points, devices: workspace.devices, records: workspace.records,
    events: workspace.events, orders: workspace.orders, tasks: workspace.tasks, issues };
}
