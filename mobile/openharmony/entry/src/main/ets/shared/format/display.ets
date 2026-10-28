import { AlarmEvent, MonitorRecord, Point } from '../../data/models/Monitoring';
import { Workspace } from '../../data/models/Workspace';

const LABELS: Map<string, string> = new Map([
  ['crack', '裂缝'], ['tilt', '倾角'], ['vibration', '振动'], ['temp_humidity', '温湿度'], ['manual_check', '人工检查'],
  ['valid', '质量有效'], ['suspect', '质量存疑'], ['invalid', '质量无效'],
  ['normal', '判定正常'], ['yellow', '黄色关注'], ['orange', '橙色排查'], ['red', '红色紧急核查'],
  ['insufficient', '数据不足'], ['excluded', '不参与判定'],
  ['pending', '待检查'], ['checked', '已检查'], ['partial', '部分完成'], ['missed', '逾期未检'],
  ['created', '待派工'], ['assigned', '待接单'], ['repairing', '处理中'], ['submitted', '待验收'],
  ['verified', '验收通过'], ['returned', '验收退回'], ['handling', '处理中'], ['recovering', '恢复待确认'], ['closed', '已关闭'],
  ['online', '在线（模拟）'], ['offline', '离线（模拟）'], ['unknown', '未知'],
  ['manual', '手工录入'], ['device', '设备接口（模拟）'], ['csv', 'CSV导入']
]);

export function label(value: string): string {
  return LABELS.get(value) ?? value;
}

export function timeText(value: string | null): string {
  if (!value) return '未提供';
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? '时间无效' : time.toLocaleString('zh-CN');
}

export function numberText(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

export function activePoints(workspace: Workspace): Point[] {
  return workspace.points.filter((point: Point) => point.status === 'active');
}

export function latestRecord(workspace: Workspace, pointId: string): MonitorRecord | undefined {
  return workspace.records.filter((record: MonitorRecord) => record.pointId === pointId)
    .sort((left: MonitorRecord, right: MonitorRecord) => Date.parse(right.sampleTime) - Date.parse(left.sampleTime) ||
      right.enteredAt.localeCompare(left.enteredAt) || right.id.localeCompare(left.id))[0];
}

export function reading(record: MonitorRecord | undefined, type: string): string {
  if (!record) return type === 'manual_check' ? '人工检查点' : '暂无记录';
  if (type === 'crack') return `${numberText(record.values.width)} ${record.unit}`;
  if (type === 'tilt') return `X ${numberText(record.values.angleX)} / Y ${numberText(record.values.angleY)} ${record.unit}`;
  if (type === 'vibration') return `${numberText(record.values.accelRms)} ${record.unit} · RMS`;
  if (type === 'temp_humidity') return `${numberText(record.values.temperature)} ℃ / ${numberText(record.values.humidity)} %`;
  return '人工检查点';
}

export function pointLocation(workspace: Workspace, point: Point): string {
  const building = workspace.buildings.find((item) => item.id === point.buildingId);
  const floor = workspace.floors.find((item) => item.id === point.floorId);
  return `${building?.name ?? '楼栋未提供'} · ${floor?.name ?? '楼层未提供'}`;
}

export function openEvents(workspace: Workspace): AlarmEvent[] {
  return workspace.events.filter((event: AlarmEvent) => event.status !== 'closed');
}

export function visibleEvents(workspace: Workspace, type: string, history: boolean): AlarmEvent[] {
  const ids = new Set(workspace.points.filter((point) => point.type === type).map((point) => point.id));
  return workspace.events.filter((event) => (history || event.status !== 'closed') &&
    (type === 'all' || ids.has(event.pointId)));
}

export function freshness(record: MonitorRecord | undefined): string {
  if (!record) return '未取得采样时间';
  const age = Date.now() - Date.parse(record.sampleTime);
  if (!Number.isFinite(age)) return '采样时间无效';
  if (age < -60000) return '采样时间晚于当前设备时间，请核对';
  return age > 3600000 ? '历史采样，非实时数据' : '近一小时采样';
}
