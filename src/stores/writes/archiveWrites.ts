/**
 * 建档与归档写入。
 * 原则：有历史记录后只归档不删除；每次写入同时更新记录与操作日志。
 */
import type {
  Building,
  DataSource,
  Device,
  DeviceHealth,
  Floor,
  Footprint,
  MetricValues,
  NormPoint,
  Point,
  PointType,
} from '@/types/domain'
import { pointTypeDef } from '@/types/catalog'
import { labelConflict } from '@/core/inspection/checkIn'
import { nextBuildingCode, nextDeviceCode, nextPointCode, uid } from '@/core/id'
import { nowIso } from '@/core/time'
import { commitBaselineVersion, putBuilding, putDevice, putFloor, putPoint } from '@/db/repo'
import { useArchiveStore } from '../archive'
import { useSessionStore } from '../session'
import { backendActive } from '@/api/backend/runtime'
import {
  saveBaselineRemote,
  saveBuildingRemote,
  saveDeviceRemote,
  saveFloorRemote,
  savePointRemote,
} from '@/api/backend/archive'

export interface BuildingDraft {
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
  footprint: Footprint
}

export interface FloorDraft {
  buildingId: string
  floorNo: number
  name: string
  /** 区域名称，以顿号、逗号或空格分隔；第 1 项为走廊，其后依次为房间 */
  zonesText: string
  planVersion: number
  remark: string
}

export interface PointDraft {
  code: string
  name: string
  buildingId: string
  floorId: string
  zoneId: string
  type: PointType
  coord: NormPoint
  planVersion: number
  owner: string
  backupPerson: string
  installDate: string
  dataSource: DataSource
  remark: string
  /** NFC 标签编号；留空表示暂不绑定。保存前会校验全校唯一 */
  nfcLabel: string
  /** 位置变更原因；位置发生变化时必填，随变更记录留痕 */
  locationReason: string
}

export interface DeviceDraft {
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
  health: DeviceHealth
  remark: string
}

export interface BaselineDraft {
  pointId: string
  values: MetricValues
  unit: string
  reason: string
  effectiveFrom: string
}

export function parseZones(text: string): string[] {
  return text
    .split(/[、,，;；\s]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

export function suggestBuildingCode(): string {
  return nextBuildingCode(useArchiveStore().buildings)
}

export function suggestPointCode(buildingId: string, floorId: string, type: PointType): string {
  const store = useArchiveStore()
  const building = store.buildingById(buildingId)
  const floor = store.floorById(floorId)
  if (building === undefined || floor === undefined) return ''
  return nextPointCode({
    buildingCode: building.code,
    floorNo: floor.floorNo,
    type,
    existing: store.pointsOfBuilding(buildingId, true),
  })
}

export function suggestDeviceCode(pointId: string): string {
  const store = useArchiveStore()
  const point = store.pointById(pointId)
  if (point === undefined) return ''
  return nextDeviceCode(point.code, store.devices)
}

export async function saveBuilding(id: string | null, draft: BuildingDraft): Promise<Building> {
  const store = useArchiveStore()
  const session = useSessionStore()
  const at = nowIso()
  const existing = id === null ? undefined : store.buildingById(id)
  if (backendActive()) {
    const saved = await saveBuildingRemote(id, draft, existing?.rev)
    await store.reload()
    return saved
  }
  const row: Building = {
    ...draft,
    id: existing?.id ?? uid('bld'),
    createdAt: existing?.createdAt ?? at,
    createdBy: existing?.createdBy ?? session.name,
    updatedAt: at,
    updatedBy: session.name,
    status: existing?.status ?? 'active',
    archiveReason: existing?.archiveReason ?? '',
    archivedAt: existing?.archivedAt ?? null,
    archivedBy: existing?.archivedBy ?? '',
  }
  await putBuilding(row)
  await store.log(
    existing === undefined ? 'create' : 'update',
    'building',
    row.id,
    `${row.code} ${row.name}`,
    existing === undefined ? `新建楼栋档案 ${row.code} ${row.name}` : `修改楼栋档案 ${row.code} ${row.name}`,
  )
  await store.reload()
  return row
}

export async function saveFloor(id: string | null, draft: FloorDraft): Promise<Floor> {
  const store = useArchiveStore()
  const session = useSessionStore()
  const at = nowIso()
  const existing = id === null ? undefined : store.floorById(id)
  if (existing !== undefined) {
    const orphans = pointsInRemovedZones(existing.id, parseZones(draft.zonesText))
    if (orphans.length > 0) {
      throw new Error(
        `有 ${orphans.length} 个测点仍在引用将被删除的区域（${orphans.map((p) => p.code).join('、')}），请先调整这些测点或保留区域名称`,
      )
    }
  }
  if (backendActive()) {
    const saved = await saveFloorRemote(
      id,
      {
        buildingId: draft.buildingId,
        floorNo: draft.floorNo,
        name: draft.name,
        zones: parseZones(draft.zonesText),
        planVersion: draft.planVersion,
        remark: draft.remark,
      },
      existing?.rev,
    )
    await store.reload()
    return saved
  }
  const row: Floor = {
    id: existing?.id ?? uid('flr'),
    buildingId: draft.buildingId,
    floorNo: draft.floorNo,
    name: draft.name,
    zones: parseZones(draft.zonesText),
    planVersion: draft.planVersion,
    remark: draft.remark,
    createdAt: existing?.createdAt ?? at,
    createdBy: existing?.createdBy ?? session.name,
    updatedAt: at,
    updatedBy: session.name,
    status: existing?.status ?? 'active',
    archiveReason: existing?.archiveReason ?? '',
    archivedAt: existing?.archivedAt ?? null,
    archivedBy: existing?.archivedBy ?? '',
  }
  await putFloor(row)
  await store.log(
    existing === undefined ? 'create' : 'update',
    'floor',
    row.id,
    `${store.buildingName(row.buildingId)} ${row.name}`,
    existing === undefined ? `新建楼层 ${row.name}` : `修改楼层 ${row.name}`,
  )
  await store.reload()
  return row
}

/** 位置是否发生变化：楼栋、楼层、区域或图上坐标任一不同即为移动。 */
export function locationChanged(point: Point, draft: PointDraft): boolean {
  return (
    point.buildingId !== draft.buildingId ||
    point.floorId !== draft.floorId ||
    point.zoneId !== draft.zoneId ||
    Math.abs(point.coord.x - draft.coord.x) > 1e-6 ||
    Math.abs(point.coord.y - draft.coord.y) > 1e-6
  )
}

/** 楼层区域被删除时，仍引用这些区域的测点；为空才允许保存楼层。 */
export function pointsInRemovedZones(floorId: string, nextZones: string[]): Point[] {
  const store = useArchiveStore()
  return store.pointsOfFloor(floorId, true).filter((point) => !nextZones.includes(point.zoneId))
}

/** 绑定或换绑标签：编号不变则保留原版本，编号变化则版本递增并记原因。 */
function buildNfc(existing: Point | undefined, label: string, at: string, by: string): Point['nfc'] {
  if (existing?.nfc === undefined || existing.nfc === null) {
    return { code: label, version: 1, boundAt: at, boundBy: by, remark: '建档时绑定' }
  }
  if (existing.nfc.code === label) return existing.nfc
  return { code: label, version: existing.nfc.version + 1, boundAt: at, boundBy: by, remark: '换绑标签，历史打卡保留当时编号与版本' }
}

export async function savePoint(id: string | null, draft: PointDraft): Promise<Point> {
  const store = useArchiveStore()
  const session = useSessionStore()
  const at = nowIso()
  const existing = id === null ? undefined : store.pointById(id)
  const moved = existing !== undefined && locationChanged(existing, draft)
  if (moved && draft.locationReason.trim() === '') {
    throw new Error('位置发生变化，必须填写位置变更原因')
  }
  const label = draft.nfcLabel.trim() === '' ? `NFC-${draft.code.trim().toUpperCase()}` : draft.nfcLabel.trim()
  /*
   * 标签编号必须全校唯一：两个测点绑同一张卡时，两个任务都可能判成"到点"，
   * 到点证明就失效了。换绑同一个点位的编号不算冲突（排除自己）。
   */
  const conflict = labelConflict(store.points, label, id)
  if (conflict !== null) {
    throw new Error(`NFC 标签 ${label} 已绑定在 ${conflict.pointCode} ${conflict.pointName}，一个编号只能绑一个测点`)
  }
  if (backendActive()) {
    const saved = await savePointRemote(id, draft, existing?.rev)
    await store.reload()
    return saved
  }
  const { locationReason, nfcLabel, ...rest } = draft
  const row: Point = {
    ...rest,
    metric: pointTypeDef(draft.type).metric,
    // 编号变了就是换绑：版本递增，历史打卡里读到的旧编号与版本保持不动
    nfc: buildNfc(existing, label, at, session.name),
    locationHistory:
      moved && existing !== undefined
        ? [
            ...existing.locationHistory,
            {
              at,
              by: session.name,
              role: session.roleLabel,
              reason: locationReason.trim(),
              from: {
                buildingId: existing.buildingId,
                floorId: existing.floorId,
                zoneId: existing.zoneId,
                coord: { ...existing.coord },
              },
              to: {
                buildingId: draft.buildingId,
                floorId: draft.floorId,
                zoneId: draft.zoneId,
                coord: { ...draft.coord },
              },
            },
          ]
        : (existing?.locationHistory ?? []),
    id: existing?.id ?? uid('pnt'),
    createdAt: existing?.createdAt ?? at,
    createdBy: existing?.createdBy ?? session.name,
    updatedAt: at,
    updatedBy: session.name,
    status: existing?.status ?? 'active',
    archiveReason: existing?.archiveReason ?? '',
    archivedAt: existing?.archivedAt ?? null,
    archivedBy: existing?.archivedBy ?? '',
  }
  await putPoint(row)
  await store.log(
    existing === undefined ? 'create' : 'update',
    'point',
    row.id,
    `${row.code} ${row.name}`,
    existing === undefined
      ? `新建测点 ${row.code}`
      : moved
        ? `修改测点 ${row.code}（含位置变更，已留痕）`
        : `修改测点 ${row.code}`,
    moved ? locationReason.trim() : '',
  )
  await store.reload()
  return row
}

/** 量程文本由上下限派生，避免同一事实两处维护。 */
function formatRange(min: number | null, max: number | null, unit: string): string {
  if (min === null || max === null) return ''
  return `${min}~${max}${unit.trim() === '' ? '' : ` ${unit.trim()}`}`
}

export async function saveDevice(id: string | null, draft: DeviceDraft): Promise<Device> {
  const store = useArchiveStore()
  const session = useSessionStore()
  const at = nowIso()
  const existing = id === null ? undefined : store.deviceById(id)
  if (draft.rangeMin !== null && draft.rangeMax !== null && draft.rangeMin >= draft.rangeMax) {
    throw new Error('量程上限必须大于下限')
  }
  if (backendActive()) {
    const saved = await saveDeviceRemote(id, draft, existing?.rev)
    await store.reload()
    return saved
  }
  const row: Device = {
    ...draft,
    rangeText: formatRange(draft.rangeMin, draft.rangeMax, draft.unit),
    id: existing?.id ?? uid('dev'),
    createdAt: existing?.createdAt ?? at,
    createdBy: existing?.createdBy ?? session.name,
    updatedAt: at,
    updatedBy: session.name,
    status: existing?.status ?? 'active',
    archiveReason: existing?.archiveReason ?? '',
    archivedAt: existing?.archivedAt ?? null,
    archivedBy: existing?.archivedBy ?? '',
  }
  await putDevice(row)
  await store.log(
    existing === undefined ? 'create' : 'update',
    'device',
    row.id,
    `${row.code} ${row.name}`,
    existing === undefined ? `登记设备 ${row.code}` : `修改设备 ${row.code}`,
  )
  await store.reload()
  return row
}

/** 基准值改变需记录版本与原因；历史版本不覆盖，录入记录保存当时的基准快照。 */
export async function saveBaseline(draft: BaselineDraft): Promise<number> {
  const store = useArchiveStore()
  const session = useSessionStore()
  const history = store.baselineHistory(draft.pointId)
  const version = history.length === 0 ? 1 : history[0].version + 1
  const at = nowIso()

  if (backendActive()) {
    const saved = await saveBaselineRemote(draft, history.length === 0 ? null : history[0].version)
    await store.reload()
    return saved.version
  }

  // 旧版本置为非当前 + 写入新当前版必须同事务：分开写时中途失败会留下"该测点没有当前基准"
  await commitBaselineVersion({
    cleared: history.map((row) => ({ ...row, current: false })),
    next: {
      id: uid('bas'),
      pointId: draft.pointId,
      metric: pointTypeDef(store.pointById(draft.pointId)?.type ?? 'crack').metric,
      values: draft.values,
      unit: draft.unit,
      version,
      reason: draft.reason,
      effectiveFrom: draft.effectiveFrom,
      createdBy: session.name,
      createdAt: at,
      current: true,
    },
  })
  await store.log(
    'update',
    'baseline',
    draft.pointId,
    store.pointLabel(draft.pointId),
    `基准值更新为 v${version}`,
    draft.reason,
  )
  await store.reload()
  return version
}

/** 规则保存草稿：阈值与适用范围可改，改动记入操作日志便于追溯。 */
