import { Workspace } from '../../../data/models/Workspace';
import { InspectionTask, WorkOrder } from '../../../data/models/Tasks';
import { IssueRecord } from '../../../data/models/Reports';
import { AlarmEvent } from '../../../data/models/Monitoring';
import { MaintenanceTask } from '../../../data/models/business/Maintenance';
export function mergeWorkspace(remote: Workspace, local: Workspace): Workspace {
  if (remote.epoch !== local.epoch) return remote;
  remote.tasks = remote.tasks.map((row): InspectionTask => local.tasks.find((old) => old.id === row.id && old.rev > row.rev) ?? row);
  remote.orders = remote.orders.map((row): WorkOrder => local.orders.find((old) => old.id === row.id && old.rev > row.rev) ?? row);
  remote.issues = remote.issues.map((row): IssueRecord => local.issues.find((old) => old.id === row.id && old.rev > row.rev) ?? row);
  remote.events = remote.events.map((row): AlarmEvent => local.events.find((old) => old.id === row.id && old.rev > row.rev) ?? row);
  remote.maintenance = remote.maintenance?.map((row): MaintenanceTask => local.maintenance?.find((old) => old.id === row.id && old.rev > row.rev) ?? row);
  return remote;
}
