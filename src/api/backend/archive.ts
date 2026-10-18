/** 档案、基准与规则的服务端适配：请求体保持前端领域字段，服务端算版本与审计。 */
import type { AuditLog, Baseline, Building, DataSource, Device, Floor, MetricValues, Point } from '@/types/domain'
import type { MonitoringRule, PersistenceCondition, RecoveryCondition, RuleThresholds } from '@/types/rules'
import type { ArchiveTarget } from '@/stores/writes/archiveActions'
import { command, read, setEpoch } from './runtime'

export interface ArchiveSnapshot {
  epoch: number
  buildings: Building[]
  floors: Floor[]
  points: Point[]
  devices: Device[]
  baselines: Baseline[]
  rules: MonitoringRule[]
  audits: AuditLog[]
}

export interface FloorPayload {
  buildingId: string
  floorNo: number
  name: string
  zones: string[]
  planVersion: number
  remark: string
}

export interface PointPayload {
  code: string
  name: string
  buildingId: string
  floorId: string
  zoneId: string
  type: Point['type']
  coord: Point['coord']
  planVersion: number
  owner: string
  backupPerson: string
  installDate: string
  dataSource: DataSource
  remark: string
  nfcLabel: string
  locationReason: string
}

export interface DevicePayload {
  code: string
  name: string
  pointId: string
  model: string
  serial: string
  rangeMin: number | null
  rangeMax: number | null
  unit: string
  nodeId: string
  gateway: string
  mountPosition: string
  direction: string
  installDate: string
  calibratedAt: string
  health: Device['health']
  remark: string
}

export interface BuildingPayload {
  code: string
  name: string
  purpose: string
  buildYear: number | null
  floorCount: number | null
  area: number | null
  structureType: string
  managerUnit: string
  userUnit: string
  owner: string
  ownerPhone: string
  backupPerson: string
  source: string
  remark: string
  dataSource: DataSource
  footprint: Building['footprint']
}

export interface BaselinePayload {
  pointId: string
  values: MetricValues
  unit: string
  reason: string
  effectiveFrom: string
}

export interface RuleVersionPayload {
  code: string
  name: string
  unit: string
  enabled: boolean
  thresholds: RuleThresholds | null
  rateThreshold: number | null
  persistence: PersistenceCondition
  recovery: RecoveryCondition
  environment: MonitoringRule['environment']
  confirmedBy: string
  note: string
  effectiveFrom: string
}

export async function fetchArchive(): Promise<ArchiveSnapshot> {
  const data = await read<ArchiveSnapshot>('/archive')
  setEpoch(data.epoch)
  return data
}

function revSuffix(id: string | null, rev: number | undefined): string {
  return id === null ? 'new' : `${id}|${rev ?? 0}`
}

export async function saveBuildingRemote(
  id: string | null, payload: BuildingPayload, expectedRev: number | undefined,
): Promise<Building> {
  const result = id === null
    ? await command<Building>('/buildings', {
        method: 'POST', body: payload, key: `archive_write|building|${payload.code}`,
      })
    : await command<Building>(`/buildings/${id}`, {
        method: 'PATCH', body: { ...payload, expectedRev },
        key: `archive_write|building|${revSuffix(id, expectedRev)}`,
      })
  return result.data
}

export async function saveFloorRemote(
  id: string | null, payload: FloorPayload, expectedRev: number | undefined,
): Promise<Floor> {
  const result = id === null
    ? await command<Floor>('/floors', {
        method: 'POST', body: payload, key: `archive_write|floor|${payload.buildingId}|${payload.floorNo}`,
      })
    : await command<Floor>(`/floors/${id}`, {
        method: 'PATCH', body: { ...payload, expectedRev },
        key: `archive_write|floor|${revSuffix(id, expectedRev)}`,
      })
  return result.data
}

export async function savePointRemote(
  id: string | null, payload: PointPayload, expectedRev: number | undefined,
): Promise<Point> {
  const result = id === null
    ? await command<Point>('/points', {
        method: 'POST', body: payload, key: `archive_write|point|${payload.code}`,
      })
    : await command<Point>(`/points/${id}`, {
        method: 'PATCH', body: { ...payload, expectedRev },
        key: `archive_write|point|${revSuffix(id, expectedRev)}`,
      })
  return result.data
}

export async function saveDeviceRemote(
  id: string | null, payload: DevicePayload, expectedRev: number | undefined,
): Promise<Device> {
  const result = id === null
    ? await command<Device>('/devices', {
        method: 'POST', body: payload, key: `archive_write|device|${payload.code}`,
      })
    : await command<Device>(`/devices/${id}`, {
        method: 'PATCH', body: { ...payload, expectedRev },
        key: `archive_write|device|${revSuffix(id, expectedRev)}`,
      })
  return result.data
}

export async function archiveRemote(
  kind: ArchiveTarget, id: string, archived: boolean, reason: string, expectedRev: number | undefined,
): Promise<Building | Floor | Point | Device> {
  const action = archived ? 'archive' : 'restore'
  const result = await command<Building | Floor | Point | Device>(`/archive/${id}/${action}`, {
    body: { kind, reason, expectedRev },
    key: `archive_write|${kind}|${id}|${action}|${expectedRev ?? 0}`,
  })
  return result.data
}

export async function saveBaselineRemote(
  payload: BaselinePayload, expectedVersion: number | null,
): Promise<Baseline> {
  const result = await command<Baseline>('/baselines', {
    body: { ...payload, expectedVersion },
    key: `baseline_write|${payload.pointId}|${expectedVersion ?? 0}`,
  })
  return result.data
}

export async function saveRuleVersionRemote(
  rule: MonitoringRule, payload: RuleVersionPayload,
): Promise<MonitoringRule> {
  const result = await command<MonitoringRule>(`/rules/${rule.ruleId}/versions`, {
    body: {
      ...payload,
      metric: rule.metric,
      buildingIds: rule.buildingIds,
      pointIds: rule.pointIds,
      baselineSource: rule.baselineSource,
      fixedBaseline: rule.fixedBaseline,
      rateLevel: rule.rateLevel,
      source: rule.source,
      expectedRev: rule.rev,
      expectedVersion: rule.version,
    },
    key: `rule_write|${rule.ruleId}|${rule.version}`,
  })
  return result.data
}
