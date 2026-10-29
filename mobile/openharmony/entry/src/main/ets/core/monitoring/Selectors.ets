import { Point, Device, AlarmEvent } from '../../data/models/Monitoring';
import { InspectionTask } from '../../data/models/Tasks';
import { Workspace } from '../../data/models/Workspace';

export interface PointFilter { buildingId: string; floorId: string; type: string; }
export interface TaskFilter { date: string; status: string; kind: string; }

export function filterPoints(points: Point[], filter: PointFilter): Point[] {
  return points.filter((row) => row.status === 'active' && (!filter.buildingId || row.buildingId === filter.buildingId) &&
    (!filter.floorId || row.floorId === filter.floorId) && (filter.type === 'all' || row.type === filter.type));
}

export function filterEvents(workspace: Workspace, filter: PointFilter, history: boolean): AlarmEvent[] {
  const points = new Set(workspace.points.filter((row) => (history || row.status === 'active') &&
    (!filter.buildingId || row.buildingId === filter.buildingId) && (!filter.floorId || row.floorId === filter.floorId) &&
    (filter.type === 'all' || row.type === filter.type)).map((row) => row.id));
  return workspace.events.filter((row) => points.has(row.pointId) && (history || row.status !== 'closed'));
}

export function shanghaiDay(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : '';
}

export function validTaskDate(value: string): boolean {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function filterTasks(tasks: InspectionTask[], filter: TaskFilter): InspectionTask[] {
  return tasks.filter((row) => (!filter.date || shanghaiDay(row.plannedAt) === filter.date) &&
    (filter.status === 'all' || row.status === filter.status) && (filter.kind === 'all' || row.planSnapshot.kind === filter.kind));
}

export function deviceSummary(device: Device): string {
  const data = device.telemetry;
  if (!data || data.source !== 'simulation') return '连接未知 · 电量未知 · 最近设备上报未知';
  const connection = data.connection === 'online' ? '在线' : data.connection === 'offline' ? '离线' : '连接未知';
  const value = data.batteryPercent;
  const battery = value !== null && Number.isFinite(value) && value >= 0 && value <= 100 ? `${value}%${value <= 20 ? ' 低电量' : ''}` : '未知';
  const time = data.lastReportAt && Number.isFinite(Date.parse(data.lastReportAt)) ? new Date(data.lastReportAt).toLocaleString('zh-CN') : '未知';
  return `${connection}（模拟） · 电量 ${battery} · 最近上报 ${time}`;
}
