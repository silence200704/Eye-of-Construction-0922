import { Point, Device } from '../../data/models/Monitoring';
import { InspectionTask } from '../../data/models/Tasks';

export interface PointFilter { buildingId: string; floorId: string; type: string; }
export interface TaskFilter { date: string; status: string; kind: string; }

export function filterPoints(points: Point[], filter: PointFilter): Point[] {
  return points.filter((row) => row.status === 'active' && (!filter.buildingId || row.buildingId === filter.buildingId) &&
    (!filter.floorId || row.floorId === filter.floorId) && (filter.type === 'all' || row.type === filter.type));
}

export function shanghaiDay(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : '';
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
