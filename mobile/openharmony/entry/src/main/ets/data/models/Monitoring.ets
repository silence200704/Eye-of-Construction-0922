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
}

export interface Device {
  id: string;
  pointId: string;
  name: string;
  status: string;
  health: string;
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
}
