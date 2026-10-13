/**
 * 校园空间模型投影（纯只读）：把档案（楼栋 / 楼层 / 测点）折算成 3D 场景与事实卡要用的结构。
 *
 * 这里**不做任何业务判定**：事件等级由调用方按已落库的事件传入（`eventLevelByPoint`），
 * 读数、质量、来源仍走原来的只读选择器。楼栋声明层数与楼层档案数对不上时，
 * 缺的那几层在模型里如实保留为"未建档"（`floor: null`），不伪造房间、测点或传感器。
 */
import type { Building, Floor, Point } from '@/types/domain'
import type { EventLevel } from '@/types/events'
import {
  buildingWorld,
  levelY,
  MAX_MOUNT_DISTANCE,
  mountHeightOf,
  type BuildingWorld,
} from './coordinates'
import { contentToLocal, floorLayoutOf, mountOnWall, wallFacesOf, type FloorLayout, type WallFace } from './layout'

/**
 * 测点的**墙体定位位置**：当前档案没有安装方式或埋深，
 * 所以投影只给出"落在哪面墙、示意离地多高、朝哪一侧"，
 * 场景只负责把它画出来 —— 数据与渲染不各算一遍。
 */
export interface PointMount {
  /** 贴在哪个区域的墙面上（走廊 / 房间名） */
  zoneLabel: string
  /** 垂足在平面上的位置（内容坐标 0~1000 / 0~700） */
  x: number
  y: number
  /** 离该墙面的垂直距离（内容坐标单位） */
  distance: number
  /** 墙面指向区域内部的单位法线（内容坐标平面内） */
  nx: number
  ny: number
}

export interface PointMarker {
  point: Point
  /** 贴墙安装位置；null = 附近没有合适墙面，按平面坐标落位（不硬凑） */
  mount: PointMount | null
  /** 建议安装高度（离楼面，世界单位），按指标类型取 */
  mountHeight: number
  /** 安装点（含高度）在楼栋局部平面上的位置，供"点中的是哪个测点"之类的近邻判断 */
  local: { x: number; z: number }
  /** 已落库事件里的最高等级；没有未关闭事件就是 null（不能读成"设备在线"） */
  eventLevel: EventLevel | null
  archived: boolean
}

export interface LevelModel {
  levelIndex: number
  floorNo: number
  name: string
  /** 未建档层为 null：楼栋声明了这层，但档案里没有 */
  floor: Floor | null
  layout: FloorLayout
  y: number
  markers: PointMarker[]
}

export interface BuildingModel {
  building: Building
  world: BuildingWorld
  /** 按层号升序；含未建档的占位层 */
  levels: LevelModel[]
  missingFloorNos: number[]
  pointCount: number
  /** 该楼栋所有未关闭事件的最高等级，用于体量着色（无事件为 null） */
  maxEventLevel: EventLevel | null
  archived: boolean
}

export interface CampusModel {
  buildings: BuildingModel[]
  /** 已建档楼层总数（不含未建档占位层） */
  builtFloorCount: number
}

export interface CampusModelInput {
  buildings: Building[]
  floors: Floor[]
  points: Point[]
  eventLevelByPoint?: Record<string, EventLevel | null>
}

const LEVEL_RANK: Record<EventLevel, number> = { yellow: 1, orange: 2, red: 3 }

/** 取等级更高的一方（null 表示无事件）。投影与页面都用这一处，避免两套排序口径。 */
export function higherEventLevel(a: EventLevel | null, b: EventLevel | null): EventLevel | null {
  if (a === null) return b
  if (b === null) return a
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b
}

/**
 * 楼层清单：档案里已有的按层号排序；楼栋声明层数大于建档数时，
 * 在**末尾**补出缺失层号的占位（`floor: null`）。
 * 只按声明补"缺的层号"，不去猜房间或测点。
 */
function levelsOf(building: Building, floors: Floor[]): { floorNo: number; floor: Floor | null }[] {
  const rows = floors
    .filter((row) => row.buildingId === building.id)
    .slice()
    .sort((a, b) => a.floorNo - b.floorNo)
  const declared = building.floorCount ?? rows.length
  const out: { floorNo: number; floor: Floor | null }[] = rows.map((row) => ({ floorNo: row.floorNo, floor: row }))
  for (let floorNo = 1; floorNo <= declared; floorNo += 1) {
    if (!out.some((row) => row.floorNo === floorNo)) out.push({ floorNo, floor: null })
  }
  out.sort((a, b) => a.floorNo - b.floorNo)
  return out
}

function mountOf(point: Point, faces: WallFace[]): PointMount | null {
  const content = { x: point.coord.x * 1000, y: point.coord.y * 700 }
  const mount = mountOnWall(faces, content)
  // 离墙太远、或垂足落在墙段之外，都按"没找到合适墙面"处理：不把测点硬按到别的房间的墙上
  if (mount === null || mount.distance > MAX_MOUNT_DISTANCE || !mount.withinSpan) return null
  return {
    zoneLabel: mount.face.zoneLabel,
    x: mount.x,
    y: mount.y,
    distance: mount.distance,
    nx: mount.face.nx,
    ny: mount.face.ny,
  }
}

function markersOf(
  points: Point[],
  layout: FloorLayout,
  eventLevelByPoint: Record<string, EventLevel | null>,
): PointMarker[] {
  const faces = layout.zones.length === 0 ? [] : wallFacesOf(layout)
  return points.map((point) => {
    const mount = mountOf(point, faces)
    const content = mount === null
      ? { x: point.coord.x * 1000, y: point.coord.y * 700 }
      : { x: mount.x, y: mount.y }
    const local = contentToLocal(content)
    const mountHeight = mountHeightOf(point.type)
    return {
      point,
      mount,
      mountHeight,
      local: { x: local.x - 0.5, z: local.y - 0.5 },
      eventLevel: eventLevelByPoint[point.id] ?? null,
      archived: point.status !== 'active',
    }
  })
}

/** 档案 → 校园模型。传进来的就是"要画的那些"（调用方按 active 过滤），这里不额外筛。 */
export function buildCampusModel(input: CampusModelInput): CampusModel {
  const eventLevelByPoint = input.eventLevelByPoint ?? {}
  let builtFloorCount = 0

  const buildings = input.buildings.map((building) => {
    const world = buildingWorld(building.footprint)
    const owned = input.points.filter((row) => row.buildingId === building.id)
    const slots = levelsOf(building, input.floors)
    let maxEventLevel: EventLevel | null = null

    const levels = slots.map((slot, levelIndex) => {
      const floorPoints = slot.floor === null ? [] : owned.filter((row) => row.floorId === slot.floor?.id)
      const layout = floorLayoutOf(slot.floor?.zones ?? [])
      const markers = markersOf(floorPoints, layout, eventLevelByPoint)
      for (const marker of markers) maxEventLevel = higherEventLevel(maxEventLevel, marker.eventLevel)
      if (slot.floor !== null) builtFloorCount += 1
      return {
        levelIndex,
        floorNo: slot.floorNo,
        name: slot.floor?.name ?? `${slot.floorNo} 层（未建档）`,
        floor: slot.floor,
        layout,
        y: levelY(levelIndex),
        markers,
      }
    })

    return {
      building,
      world,
      levels,
      missingFloorNos: levels.filter((row) => row.floor === null).map((row) => row.floorNo),
      pointCount: owned.length,
      maxEventLevel,
      archived: building.status !== 'active',
    }
  })

  return { buildings, builtFloorCount }
}

/** 按测点 ID 找到它所在的楼栋与楼层模型（选中、深链、事实卡都要用） */
export function locatePoint(
  model: CampusModel,
  pointId: string,
): { building: BuildingModel; level: LevelModel; marker: PointMarker } | null {
  for (const building of model.buildings) {
    for (const level of building.levels) {
      const marker = level.markers.find((row) => row.point.id === pointId)
      if (marker !== undefined) return { building, level, marker }
    }
  }
  return null
}
