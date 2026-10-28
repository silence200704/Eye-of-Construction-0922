import { Building, Floor, Point, Device, MonitorRecord, AlarmEvent } from './Monitoring';
import { InspectionTask, WorkOrder } from './Tasks';

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
}

export function emptyWorkspace(): Workspace {
  return { epoch: 0, buildings: [], floors: [], points: [], devices: [], records: [], events: [], tasks: [], orders: [] };
}
