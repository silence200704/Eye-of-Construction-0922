/** 测试夹具：构造最小可用的领域对象，只覆盖被测字段，其余给合法默认值。 */
import type { Baseline, Building, Device, Floor, MetricValues, MonitorRecord, Point } from '@/types/domain'
import type { MonitoringRule } from '@/types/rules'
import type { AlarmEvent, EventLevel } from '@/types/events'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'

const AT = '2026-09-15T01:30:00.000Z'

const audit = {
  createdAt: AT,
  createdBy: '测试',
  updatedAt: AT,
  updatedBy: '测试',
  status: 'active' as const,
  archiveReason: '',
  archivedAt: null,
  archivedBy: '',
}

export function makeBuilding(overrides: Partial<Building> = {}): Building {
  return {
    ...audit,
    id: 'bld_1',
    code: 'B01',
    name: '测试楼',
    purpose: '教学',
    buildYear: 2009,
    floorCount: 3,
    area: 1000,
    structureType: '框架结构',
    managerUnit: '后勤处',
    userUnit: '测试大学',
    owner: '李老师',
    ownerPhone: '',
    backupPerson: '王老师',
    source: '测试',
    footprint: { x: 0.5, y: 0.5, w: 0.18, h: 0.16, rotate: 0 },
    dataSource: 'real',
    remark: '',
    ...overrides,
  }
}

export function makeFloor(overrides: Partial<Floor> = {}): Floor {
  return {
    ...audit,
    id: 'flr_1',
    buildingId: 'bld_1',
    floorNo: 2,
    name: '二层',
    zones: ['二层走廊', '二层东教室'],
    planVersion: 1,
    remark: '',
    ...overrides,
  }
}

export function makePoint(overrides: Partial<Point> = {}): Point {
  return {
    ...audit,
    id: 'pnt_1',
    code: 'B01-F2-CRACK01',
    name: '二层走廊西墙裂缝测点',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    type: 'crack',
    metric: 'crack_width',
    coord: { x: 0.2, y: 0.44 },
    planVersion: 1,
    locationHistory: [],
    owner: '李老师',
    backupPerson: '王老师',
    installDate: '2026-09-15',
    dataSource: 'real',
    remark: '',
    // 测点在 V0.3 起默认绑定标签（编号与测点编号一致），需要"未登记"时显式传 nfc: null
    nfc: { code: `NFC-${overrides.code ?? 'B01-F2-CRACK01'}`, version: 1, boundAt: AT, boundBy: '测试', remark: '' },
    ...overrides,
  }
}

export function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    ...audit,
    id: 'dev_1',
    code: 'B01-F2-CRACK01-DEV1',
    name: '裂缝位移探头',
    pointId: 'pnt_1',
    model: 'KTC2 25mm',
    serial: 'SN-1',
    rangeMin: 0,
    rangeMax: 25,
    rangeText: '0~25 mm',
    unit: 'mm',
    nodeId: 'Hi3861-01',
    gateway: 'DAYU200',
    mountPosition: '西墙',
    direction: '垂直裂缝',
    installDate: '2026-09-15',
    calibratedAt: '2026-09-15',
    health: 'unknown',
    remark: '',
    ...overrides,
  }
}

export function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    id: 'bas_1',
    pointId: 'pnt_1',
    metric: 'crack_width',
    values: { width: 0.5 },
    unit: 'mm',
    version: 1,
    reason: '建档初始宽度',
    effectiveFrom: AT,
    createdBy: '测试',
    createdAt: AT,
    current: true,
    ...overrides,
  }
}

export function makeRecord(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return {
    id: 'rec_1',
    recordNo: 'R20260915-001',
    pointId: 'pnt_1',
    deviceId: 'dev_1',
    metric: 'crack_width',
    values: { width: 0.52 },
    unit: 'mm',
    sampleTime: '2026-09-15T10:05:00.000Z',
    sampleWindow: '',
    enteredAt: '2026-09-15T10:10:00.000Z',
    enteredBy: '测试',
    enteredByRole: '物业值班人员',
    source: 'manual',
    quality: 'valid',
    qualityNote: '',
    note: '',
    isBackfill: false,
    baselineVersion: 1,
    baselineValues: { width: 0.5 },
    revision: 0,
    revisions: [],
    createdAt: AT,
    ...overrides,
  }
}

export function makeRule(overrides: Partial<MonitoringRule> = {}): MonitoringRule {
  return {
    id: 'rule_1',
    code: 'RULE-CRACK-001',
    name: '裂缝宽度变化分级规则',
    buildingIds: [],
    pointIds: [],
    metric: 'crack_width',
    unit: 'mm',
    baselineSource: 'point',
    fixedBaseline: null,
    thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
    rateThreshold: null,
    rateLevel: 'orange',
    persistence: { minRecords: 3, minSpanMinutes: 10, maxGapMinutes: 5, level: 'orange' },
    recovery: { yellowRatio: 0.8, minRecords: 3, minSpanMinutes: 0 },
    environment: null,
    version: 'V1.0',
    enabled: true,
    source: '筑瞳 Demo 演示预警规则 V1.0',
    confirmedBy: '学校安全管理人员',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    note: '',
    createdAt: AT,
    createdBy: '测试',
    updatedAt: AT,
    updatedBy: '测试',
    ...overrides,
  }
}

/** 按裂缝记录序列造历史，用于速率与持续异常判定。 */
export function crackHistory(entries: { at: string; width: number }[]): MonitorRecord[] {
  return entries.map((entry, index) =>
    makeRecord({
      id: `rec_h${index}`,
      recordNo: `R2026091${index}-001`,
      sampleTime: entry.at,
      values: { width: entry.width },
      baselineValues: { width: 0.5 },
    }),
  )
}

export function makeEvent(overrides: Partial<AlarmEvent> = {}): AlarmEvent {
  const level = (overrides.level ?? 'yellow') as EventLevel
  return {
    id: 'evt_1',
    eventNo: 'E20260920-001',
    pointId: 'pnt_1',
    ruleId: 'rule_rule_crack_001',
    ruleCode: 'RULE-CRACK-001',
    level,
    peakLevel: level,
    status: 'pending',
    unit: 'mm',
    openedAt: AT,
    openedBy: '测试',
    lastTriggerAt: AT,
    lastTriggerValue: 0.12,
    evidences: [],
    supersededEvidences: [],
    upgrades: [],
    timeline: [],
    acknowledgedAt: null,
    acknowledgedBy: '',
    closedAt: null,
    closedBy: '',
    closeBasis: '',
    note: '',
    createdAt: AT,
    createdBy: '测试',
    updatedAt: AT,
    updatedBy: '测试',
    ...overrides,
  }
}

export const EMPTY_VALUES: MetricValues = {}

/** 一条"待审核"的人工上报问题：契约测试与复查标签用例的基座。 */
export function makeIssue(overrides: Partial<InspectionIssue> = {}): InspectionIssue {
  return {
    id: 'iss_1',
    issueNo: 'ISS-20260916-001',
    source: 'report',
    submissionKey: 'report|pnt_1|设备故障|20260916',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: 'zn_1',
    eventId: null,
    taskId: null,
    maintenanceTaskId: null,
    anomalyType: '设备故障',
    description: '一层走廊应急指示灯不亮',
    photos: [],
    status: 'pending_review',
    reviewAction: null,
    reviewCategory: '',
    reviewedAt: null,
    reviewedBy: '',
    reviewNote: '',
    duplicateOf: null,
    linkedEventId: null,
    linkedFrom: [],
    workOrderIds: [],
    rechecks: [],
    timeline: [{ at: AT, by: '测试', byRole: '学校安全管理人员', action: '提交问题', detail: '' }],
    createdAt: AT,
    createdBy: '测试',
    updatedAt: AT,
    updatedBy: '测试',
    ...overrides,
  }
}

/** 一条"已验收通过"的工单：四个时刻齐全，便于测阶段耗时；缺口场景用 overrides 制造。 */
export function makeWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: 'wo_1',
    orderNo: 'WO-20260916-001',
    origin: 'event',
    issueId: 'iss_1',
    eventId: 'evt_1',
    pointId: 'pnt_1',
    title: '裂缝测点维修',
    status: 'verified',
    assignee: '维修人员',
    assignedBy: '学校安全管理人员',
    assignedAt: '2026-09-16T02:00:00.000Z',
    dueAt: null,
    measures: '重新固定支架',
    materials: '螺栓',
    photos: [],
    submittedAt: '2026-09-16T06:00:00.000Z',
    reviews: [
      { at: '2026-09-16T10:00:00.000Z', by: '学校安全管理人员', byRole: '学校安全管理人员', action: 'verify', result: 'pass', note: '' },
    ],
    timeline: [],
    createdAt: AT,
    createdBy: '测试',
    updatedAt: AT,
    updatedBy: '测试',
    ...overrides,
  }
}
