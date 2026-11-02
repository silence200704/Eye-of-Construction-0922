export interface Building {
  id: string;
  name: string;
  code: string;
  status: string;
  dataSource: string;
}

export interface Floor {
  id: string;
  buildingId: string;
  name: string;
  status: string;
}

export interface Point {
  id: string;
  code: string;
  name: string;
  buildingId: string;
  floorId: string;
  type: string;
  status: string;
  dataSource: string;
  nfc?: NfcLabel | null;
}

export interface NfcLabel {
  code: string;
  version: number;
}

export interface Device {
  id: string;
  pointId: string;
  name: string;
  status: string;
  health: string;
  telemetry?: DeviceTelemetry | null;
}

export interface DeviceTelemetry {
  source: string;
  connection: string;
  batteryPercent: number | null;
  lastReportAt: string | null;
  updatedAt: string;
}

export interface MetricValues {
  width?: number;
  angleX?: number;
  angleY?: number;
  accelRms?: number;
  accelPeak?: number;
  temperature?: number;
  humidity?: number;
}

export interface Assessment {
  state: string;
  reason?: string;
}

export interface RuleThresholdSnapshot {
  yellow?: number;
  orange?: number;
  red?: number;
}

export interface RuleSnapshot {
  ruleId?: string;
  ruleCode?: string;
  ruleVersion?: string;
  thresholds?: RuleThresholdSnapshot | null;
  unit?: string;
  source?: string;
}

export interface MonitorRecord {
  id: string;
  recordNo: string;
  pointId: string;
  sampleTime: string;
  enteredAt: string;
  values: MetricValues;
  unit: string;
  source: string;
  quality: string;
  isBackfill: boolean;
  ruleVersion: string | null;
  assessment?: Assessment | null;
  metric?: string;
  baselineValues?: MetricValues | null;
  ruleSnapshot?: RuleSnapshot | null;
}

export interface AlarmEvent {
  id: string;
  eventNo: string;
  pointId: string;
  level: string;
  status: string;
  openedAt: string;
  lastTriggerAt: string;
  ruleCode: string;
  unit: string;
  rev: number;
  acknowledgedBy?: string | null;
  closeBasis?: string;
  note?: string;
  timeline?: AlarmTimeline[];
}

export interface AlarmTimeline { at: string; by: string; action: string; detail: string; }
