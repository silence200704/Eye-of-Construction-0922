import { ApiClient, Envelope } from '../models/Http';
import { ArchiveSnapshot, Workspace } from '../models/Workspace';
import { AlarmEvent, MonitorRecord } from '../models/Monitoring';
import { InspectionTask, WorkOrder } from '../models/Tasks';
import { IssueRecord } from '../models/Reports';
import { MaintenanceTask } from '../models/business/Maintenance';
import { ApiError } from '../../core/network/ApiError';

export interface WorkspaceRead {
  client: ApiClient;
  isCurrent: () => boolean;
}

function assertCurrent(read: WorkspaceRead): void {
  if (!read.isCurrent()) throw new ApiError('CANCELLED', '读取已取消');
}

async function rows<T>(read: WorkspaceRead, path: string, epoch: number): Promise<T[]> {
  assertCurrent(read);
  const response = await read.client.send<T[]>(`/datasets/demo-main${path}`);
  assertCurrent(read);
  if (response.meta?.datasetEpoch !== epoch) throw new ApiError('EPOCH_CHANGED', '演示数据已更新，请重新读取。');
  if (!Array.isArray(response.data)) throw new ApiError('INVALID_RESPONSE', '服务未返回有效列表。');
  return response.data;
}

export async function readWorkspace(read: WorkspaceRead): Promise<Workspace> {
  const archive = await read.client.send<ArchiveSnapshot>('/datasets/demo-main/archive');
  assertCurrent(read);
  const data = archive.data;
  if (!Number.isInteger(data.epoch) || data.epoch < 1 || archive.meta?.datasetEpoch !== data.epoch ||
    !Array.isArray(data.buildings) || !Array.isArray(data.floors) ||
    !Array.isArray(data.points) || !Array.isArray(data.devices)) {
    throw new ApiError('INVALID_RESPONSE', '服务未返回完整档案。');
  }
  const records = await rows<MonitorRecord>(read, '/mobile/records', data.epoch);
  const events = await rows<AlarmEvent>(read, '/events?status=all', data.epoch);
  const tasks = await rows<InspectionTask>(read, '/inspection/tasks', data.epoch);
  const orders = await rows<WorkOrder>(read, '/work-orders', data.epoch);
  const issues = await rows<IssueRecord>(read, '/issues', data.epoch);
  const supplementableIds = await rows<string>(read, '/issues/supplement-targets', data.epoch);
  const maintenance = await rows<MaintenanceTask>(read, '/maintenance/tasks', data.epoch);
  return { epoch: data.epoch, buildings: data.buildings, floors: data.floors, points: data.points,
    devices: data.devices, records, events, tasks, orders, issues, supplementableIds, maintenance };
}
