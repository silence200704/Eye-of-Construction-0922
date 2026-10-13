/**
 * 校园视图的路由选择解析（纯函数）：`/campus?view=3d&b=<楼栋>&f=<楼层>&point=<测点>`。
 *
 * 与 `assistant/deepLink.ts` 同一套纪律：链接里的对象必须**对着当前数据集复核**。
 * 找不到、已归档、或楼层其实不属于该楼栋（错归属）时，一律不给"就当它是那个"的默认值，
 * 而是把能确定的部分留下、把确定不了的部分清空并给出原因，由页面显示空态。
 *
 * 校验的是"归属"，不是"存在"：`floorId` 属于别的楼栋、`pointId` 属于别的楼层，
 * 都属于 §15 点名的"点位归属错误"，必须挡住——否则 3D 会把测点画到别人的楼里。
 */
import type { ArchiveStatus } from '@/types/domain'

export type SpatialView = '2d' | '3d'

export interface SpatialSelection {
  view: SpatialView
  buildingId: string
  floorId: string
  pointId: string
}

/** 非空表示要向用户说明的原因（找不到 / 已归档 / 归属对不上） */
export interface SpatialTarget extends SpatialSelection {
  reason: string
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 只认 `view=3d`（其余一律 2D）；默认视图必须是 2D，链接写错不该把页面切成 3D */
export function parseSpatialQuery(query: Record<string, unknown>): SpatialSelection {
  return {
    view: asText(query.view).toLowerCase() === '3d' ? '3d' : '2d',
    buildingId: asText(query.b),
    floorId: asText(query.f),
    pointId: asText(query.point),
  }
}

/**
 * 3D 的两个档位：
 * - `campus`：校园 3D —— 四栋**完整建筑的外观**，位置按 `footprint` 与 2D 校园图一一对应；
 * - `building`：3D 楼层 —— 进到某一栋看逐层剖面与贴墙的传感器。
 *
 * 判定只用"有没有点名楼栋"：`view=3d` 不带 `b` 就是校园，带 `b` 才进单栋。
 * 这样深链与界面按钮说的是同一件事，也不会出现"想开校园 3D 却被默认塞进第一栋"。
 */
export type SpatialStage = '2d' | 'campus' | 'building'

export function stageOf(selection: SpatialSelection): SpatialStage {
  if (selection.view !== '3d') return '2d'
  return selection.buildingId === '' ? 'campus' : 'building'
}

export interface BuildingFact {
  code: string
  name: string
  status: ArchiveStatus
}

export interface FloorFact {
  name: string
  buildingId: string
  status: ArchiveStatus
}

export interface PointFact {
  code: string
  buildingId: string
  floorId: string
  status: ArchiveStatus
}

export interface SpatialFacts {
  building?: BuildingFact
  floor?: FloorFact
  point?: PointFact
}

const NOT_FOUND = {
  building: '找不到这个楼栋：可能已被删除，或当前数据集已切换。请在下方重新选择。',
  floor: '找不到这个楼层：可能已被删除，或当前数据集已切换。请在下方重新选择。',
  point: '找不到这个测点：可能已被删除，或当前数据集已切换。请在下方重新选择。',
}

/**
 * 逐级复核链接里的三个 ID。返回的 target 只保留**核实过**的部分：
 * 比如楼栋有效但楼层错归属，就保留楼栋、清空楼层与测点，并说明原因。
 */
export function resolveSpatialTarget(query: Record<string, unknown>, look: (id: string) => SpatialFacts): SpatialTarget {
  const parsed = parseSpatialQuery(query)
  const target: SpatialTarget = { ...parsed, reason: '' }

  if (parsed.buildingId !== '') {
    const facts = look(parsed.buildingId)
    const building = facts.building
    if (building === undefined) {
      return { view: parsed.view, buildingId: '', floorId: '', pointId: '', reason: NOT_FOUND.building }
    }
    if (building.status !== 'active') {
      return {
        view: parsed.view,
        buildingId: '',
        floorId: '',
        pointId: '',
        reason: `楼栋 ${building.code} 已归档，校园图与 3D 都只按在册楼栋显示。请在下方重新选择。`,
      }
    }
  }

  if (parsed.floorId !== '') {
    const floor = look(parsed.floorId).floor
    if (floor === undefined) {
      return { ...target, floorId: '', pointId: '', reason: NOT_FOUND.floor }
    }
    if (floor.status !== 'active') {
      return { ...target, floorId: '', pointId: '', reason: `楼层「${floor.name}」已归档，无法在 3D 中展开。请重新选择。` }
    }
    if (target.buildingId !== '' && floor.buildingId !== target.buildingId) {
      return { ...target, floorId: '', pointId: '', reason: '链接里的楼层不属于这个楼栋，已按楼栋打开；请重新选择楼层。' }
    }
    if (target.buildingId === '') target.buildingId = floor.buildingId
  }

  if (parsed.pointId !== '') {
    const point = look(parsed.pointId).point
    if (point === undefined) {
      return { ...target, pointId: '', reason: NOT_FOUND.point }
    }
    if (point.status !== 'active') {
      return { ...target, pointId: '', reason: `测点 ${point.code} 已归档，3D 只按在册测点落位。请重新选择。` }
    }
    if (target.buildingId !== '' && point.buildingId !== target.buildingId) {
      return { ...target, pointId: '', reason: '链接里的测点不属于这个楼栋，已按楼栋打开；请重新选择测点。' }
    }
    if (target.floorId !== '' && point.floorId !== target.floorId) {
      return { ...target, pointId: '', reason: '链接里的测点不属于这个楼层，已按楼层打开；请重新选择测点。' }
    }
    if (target.buildingId === '') target.buildingId = point.buildingId
    if (target.floorId === '') target.floorId = point.floorId
  }

  return target
}

/** 视图 query 的拼装：只带上确实选中的对象，避免链接里出现空参数 */
export function spatialQueryOf(selection: Partial<SpatialSelection>): Record<string, string> {
  const query: Record<string, string> = {}
  if (selection.view === '3d') query.view = '3d'
  if (selection.buildingId !== undefined && selection.buildingId !== '') query.b = selection.buildingId
  if (selection.floorId !== undefined && selection.floorId !== '') query.f = selection.floorId
  if (selection.pointId !== undefined && selection.pointId !== '') query.point = selection.pointId
  return query
}
