import { MonitorRecord } from '../../data/models/Monitoring';

/** 趋势指标：一个字段一张图，单位和精度随指标走。 */
export interface TrendField {
  key: string;
  label: string;
  unit: string;
  digits: number;
}

export interface TrendPoint {
  t: number;
  value: number;
  recordId: string;
  sampleTime: string;
}

export interface TrendSummary {
  count: number;
  first: number | null;
  latest: number | null;
  min: number | null;
  max: number | null;
  change: number | null;
}

interface DayBucket {
  sum: number;
  count: number;
  timeSum: number;
}

export interface TrendThresholds {
  yellow: number | null;
  orange: number | null;
  red: number | null;
}

export interface TrendRuleInfo {
  version: string;
  thresholds: TrendThresholds | null;
}

const CRACK_FIELDS: TrendField[] = [
  { key: 'width', label: '裂缝宽度', unit: 'mm', digits: 2 },
];

const TILT_FIELDS: TrendField[] = [
  { key: 'angleX', label: 'X 轴角度', unit: '°', digits: 2 },
  { key: 'angleY', label: 'Y 轴角度', unit: '°', digits: 2 },
];

const VIBRATION_FIELDS: TrendField[] = [
  { key: 'accelRms', label: '加速度有效值', unit: 'm/s²', digits: 3 },
  { key: 'accelPeak', label: '加速度峰值', unit: 'm/s²', digits: 3 },
];

const ENVIRONMENT_FIELDS: TrendField[] = [
  { key: 'temperature', label: '温度', unit: '℃', digits: 1 },
  { key: 'humidity', label: '相对湿度', unit: '%RH', digits: 1 },
];

export function trendFields(type: string): TrendField[] {
  if (type === 'crack') return CRACK_FIELDS;
  if (type === 'tilt') return TILT_FIELDS;
  if (type === 'vibration') return VIBRATION_FIELDS;
  if (type === 'temp_humidity') return ENVIRONMENT_FIELDS;
  return [];
}

function finite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 指标值必须按字段读取，避免让 ArkTS 对无索引签名的 values 做字符串下标。 */
export function trendValue(record: MonitorRecord, key: string): number | null {
  if (key === 'width') return finite(record.values.width);
  if (key === 'angleX') return finite(record.values.angleX);
  if (key === 'angleY') return finite(record.values.angleY);
  if (key === 'accelRms') return finite(record.values.accelRms);
  if (key === 'accelPeak') return finite(record.values.accelPeak);
  if (key === 'temperature') return finite(record.values.temperature);
  if (key === 'humidity') return finite(record.values.humidity);
  return null;
}

export function trendBaseline(record: MonitorRecord | undefined, key: string): number | null {
  if (!record || !record.baselineValues) return null;
  if (key === 'width') return finite(record.baselineValues.width);
  if (key === 'angleX') return finite(record.baselineValues.angleX);
  if (key === 'angleY') return finite(record.baselineValues.angleY);
  return null;
}

/** 只留采样时间在近 N 天内且带数值的记录；未来记录不参与。 */
export function filterTrendRecords(records: MonitorRecord[], days: number, now: number): MonitorRecord[] {
  const span = Math.max(1, days) * 24 * 3600000;
  const start = now - span;
  const rows = records.filter((row: MonitorRecord) => {
    const time = Date.parse(row.sampleTime);
    return Number.isFinite(time) && time >= start && time <= now;
  });
  rows.sort((left: MonitorRecord, right: MonitorRecord) => Date.parse(left.sampleTime) - Date.parse(right.sampleTime));
  return rows;
}

export function buildTrendPoints(records: MonitorRecord[], field: TrendField): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (const row of records) {
    const value = trendValue(row, field.key);
    if (value === null) continue;
    const time = Date.parse(row.sampleTime);
    if (!Number.isFinite(time)) continue;
    points.push({ t: time, value, recordId: row.id, sampleTime: row.sampleTime });
  }
  points.sort((left: TrendPoint, right: TrendPoint) => left.t - right.t);
  return points;
}

/**
 * 把同一天的多条采样合成一个平均点，默认给移动端画更直观的趋势。
 * 日期按上海时区切分；最近记录仍保留原始采样，不把日均值冒充成一条实际采样。
 */
export function dailyAveragePoints(points: TrendPoint[]): TrendPoint[] {
  if (points.length === 0) return [];
  const buckets: Map<string, DayBucket> = new Map();
  const order: string[] = [];
  for (const point of points) {
    const day = new Date(point.t + 8 * 3600000).toISOString().slice(0, 10);
    let bucket = buckets.get(day);
    if (bucket === undefined) {
      bucket = { sum: 0, count: 0, timeSum: 0 };
      buckets.set(day, bucket);
      order.push(day);
    }
    bucket.sum += point.value;
    bucket.count += 1;
    bucket.timeSum += point.t;
  }
  const averaged: TrendPoint[] = [];
  for (const day of order) {
    const bucket = buckets.get(day);
    if (bucket === undefined || bucket.count === 0) continue;
    averaged.push({
      t: bucket.timeSum / bucket.count,
      value: bucket.sum / bucket.count,
      recordId: `avg-${day}`,
      sampleTime: new Date(bucket.timeSum / bucket.count).toISOString(),
    });
  }
  return averaged;
}

export function trendSummary(points: TrendPoint[]): TrendSummary {
  if (points.length === 0) {
    return { count: 0, first: null, latest: null, min: null, max: null, change: null };
  }
  let min = points[0].value;
  let max = points[0].value;
  for (const point of points) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  const first = points[0].value;
  const latest = points[points.length - 1].value;
  return { count: points.length, first, latest, min, max, change: latest - first };
}

/**
 * 相邻记录间隔明显大于常规节奏时断开，避免一条直线跨过几天没有采样的时段。
 * 规则与电脑端趋势图一致：取常规间隔 4 倍、视野 1/4、1 小时三者中的最大值。
 */
export function splitTrendLine(points: TrendPoint[]): TrendPoint[][] {
  if (points.length === 0) return [];
  if (points.length === 1) return [[points[0]]];
  const gaps: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    gaps.push(points[index].t - points[index - 1].t);
  }
  gaps.sort((left: number, right: number) => left - right);
  const typical = gaps[Math.floor((gaps.length - 1) / 2)];
  const span = points[points.length - 1].t - points[0].t;
  const limit = Math.max(typical * 4, span * 0.25, 3600000);
  const segments: TrendPoint[][] = [];
  let current: TrendPoint[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].t - points[index - 1].t > limit) {
      segments.push(current);
      current = [];
    }
    current.push(points[index]);
  }
  segments.push(current);
  return segments;
}

function rounded(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function thresholdValue(value: number | undefined, base: number, relative: boolean): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return relative ? rounded(base + value) : value;
}

/**
 * 取最近一条带规则快照的记录。裂缝/倾角的阈值是相对基准的增量，画图时换算成绝对值；
 * 振动是绝对判定，不叠加基准。温湿度没有三级阈值，返回 null。
 */
export function trendThresholds(records: MonitorRecord[], type: string, key: string): TrendRuleInfo {
  const relative = type === 'crack' || type === 'tilt';
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const row = records[index];
    const snapshot = row.ruleSnapshot;
    if (!snapshot || !snapshot.thresholds) continue;
    const base = relative ? (trendBaseline(row, key) ?? 0) : 0;
    const yellow = thresholdValue(snapshot.thresholds.yellow, base, relative);
    const orange = thresholdValue(snapshot.thresholds.orange, base, relative);
    const red = thresholdValue(snapshot.thresholds.red, base, relative);
    if (yellow === null && orange === null && red === null) continue;
    return {
      version: snapshot.ruleVersion ?? row.ruleVersion ?? '',
      thresholds: { yellow, orange, red },
    };
  }
  return { version: '', thresholds: null };
}

export function formatTrend(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}
