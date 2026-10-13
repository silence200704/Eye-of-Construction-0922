/**
 * 楼层区域布局：**2D 平面图与 3D 楼层共用的唯一几何来源**。
 *
 * 以前这套"外轮廓 + 中间走廊 + 三列两排房间"的尺寸只写在 `FloorMap.vue` 里，
 * 3D 再写一份就必然漂移（同一个区域在两张图上位置对不上）。这里只有纯数据与纯函数，
 * 不依赖 Vue / DOM / Three.js。
 *
 * 坐标系：内容坐标 0~`VIEW_W`、0~`VIEW_H`（与 SVG 底图同一套），
 * 归一化坐标 = 内容坐标 / VIEW_W|VIEW_H，与 `Point.coord` 完全同尺度。
 */
import { VIEW_H, VIEW_W } from '@/core/map/coords'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 区域类型：走廊（贯通）或房间；楼梯间是房间的一种，只是画法不同 */
export type ZoneKind = 'corridor' | 'room'

export interface ZoneBox {
  /** 在 `Floor.zones` 里的下标；界面上按它回指区域名 */
  index: number
  label: string
  kind: ZoneKind
  stairs: boolean
  box: Box
}

export interface FloorLayout {
  /** 楼层外轮廓 */
  outline: Box
  corridor: Box
  /** 按 `zones` 顺序排列的全部区域（含走廊），3D 与 2D 都按这个顺序落位 */
  zones: ZoneBox[]
  rooms: ZoneBox[]
}

/** 平面示意图的统一尺寸（内容坐标）：外轮廓、走廊带与三条分列线 */
export const FLOOR_PLAN = {
  left: 90,
  right: 910,
  top: 110,
  bottom: 590,
  corridorTop: 300,
  corridorBottom: 400,
} as const

const FLOOR_COLS = [90, 370, 640, 910] as const

/** 没有区域名时给一个可读的占位，避免图上出现空白房间 */
function labelOf(zones: string[], index: number): string {
  return zones[index] ?? `房间${index}`
}

/**
 * 由 `Floor.zones` 生成布局：
 * `zones[0]` 是走廊，`zones[1..3]` 是上排三间，`zones[4..6]` 是下排三间。
 * 区域少于 7 个也能画，缺的位置留占位名（不伪造出第 8 个房间）。
 */
export function floorLayoutOf(zones: string[]): FloorLayout {
  const rooms: ZoneBox[] = []
  for (let column = 0; column < 3; column += 1) {
    rooms.push({
      index: column + 1,
      label: labelOf(zones, column + 1),
      kind: 'room',
      stairs: column === 1,
      box: {
        x: FLOOR_COLS[column],
        y: FLOOR_PLAN.top,
        w: FLOOR_COLS[column + 1] - FLOOR_COLS[column],
        h: FLOOR_PLAN.corridorTop - FLOOR_PLAN.top,
      },
    })
  }
  for (let column = 0; column < 3; column += 1) {
    rooms.push({
      index: column + 4,
      label: labelOf(zones, column + 4),
      kind: 'room',
      stairs: false,
      box: {
        x: FLOOR_COLS[column],
        y: FLOOR_PLAN.corridorBottom,
        w: FLOOR_COLS[column + 1] - FLOOR_COLS[column],
        h: FLOOR_PLAN.bottom - FLOOR_PLAN.corridorBottom,
      },
    })
  }
  const outline: Box = {
    x: FLOOR_PLAN.left,
    y: FLOOR_PLAN.top,
    w: FLOOR_PLAN.right - FLOOR_PLAN.left,
    h: FLOOR_PLAN.bottom - FLOOR_PLAN.top,
  }
  const corridorBox: Box = {
    x: FLOOR_PLAN.left,
    y: FLOOR_PLAN.corridorTop,
    w: FLOOR_PLAN.right - FLOOR_PLAN.left,
    h: FLOOR_PLAN.corridorBottom - FLOOR_PLAN.corridorTop,
  }
  return {
    outline,
    corridor: corridorBox,
    zones: [{ index: 0, label: labelOf(zones, 0), kind: 'corridor', stairs: false, box: corridorBox }, ...rooms],
    rooms,
  }
}

/** 区域中心（内容坐标），给 3D 里的文字标签与区域色块定位用 */
export function zoneCenter(zone: ZoneBox): { x: number; y: number } {
  return { x: zone.box.x + zone.box.w / 2, y: zone.box.y + zone.box.h / 2 }
}

/**
 * 可挂载的**墙面**：区域框的一条边 + 指向该区域内部的单位法线。
 *
 * 传感器是装在墙面上的，不是浮在房间中央：有了"哪面墙 + 内法线"，就能算出
 * 贴面位置与朝向（见 `mountOnWall`）。相邻区域共享的墙会生成两条法线相反的墙face
 * ——这是刻意的：测点在哪一侧，就取哪一侧的那条。
 */
export interface WallFace {
  /** 所属区域在 `Floor.zones` 里的下标 */
  zoneIndex: number
  zoneLabel: string
  x1: number
  y1: number
  x2: number
  y2: number
  /** 指向区域内部的单位法线（内容坐标平面内） */
  nx: number
  ny: number
  /** 边的长度（内容坐标单位） */
  length: number
}

function facesOfZone(zone: ZoneBox): WallFace[] {
  const { x, y, w, h } = zone.box
  const base = { zoneIndex: zone.index, zoneLabel: zone.label }
  return [
    { ...base, x1: x, y1: y, x2: x, y2: y + h, nx: 1, ny: 0, length: h },
    { ...base, x1: x + w, y1: y, x2: x + w, y2: y + h, nx: -1, ny: 0, length: h },
    { ...base, x1: x, y1: y, x2: x + w, y2: y, nx: 0, ny: 1, length: w },
    { ...base, x1: x, y1: y + h, x2: x + w, y2: y + h, nx: 0, ny: -1, length: w },
  ]
}

/** 一层楼里所有可挂载的墙面（走廊 + 六个房间的四条边） */
export function wallFacesOf(layout: FloorLayout): WallFace[] {
  return layout.zones.flatMap(facesOfZone)
}

export interface WallMount {
  face: WallFace
  /** 测点到墙面的垂足（内容坐标） */
  x: number
  y: number
  /** 测点到墙面的垂直距离（内容坐标单位；平面宽 1000，可作为"离墙多远"的相对量） */
  distance: number
  /** 垂足是否落在墙段内（false = 落在延长线附近，属于硬凑，调用方应谨慎） */
  withinSpan: boolean
  /** 测点是否在墙的内侧（法线一侧） */
  inside: boolean
}

/**
 * 给一个平面位置找**最近的可挂载墙面**。
 *
 * 先只在"测点在墙内侧"的墙面里挑最近的；一面都没有时（例如测点落在墙体或图纸外面）
 * 退而取几何上最近的一面，并把 `inside`/`withinSpan` 如实标出来 —— 由调用方决定
 * 是按这面墙贴，还是干脆按"未贴合墙面"处理。不猜：不确定就不装成确定。
 */
export function mountOnWall(faces: WallFace[], at: { x: number; y: number }, spanTolerance = 0.02): WallMount | null {
  let bestInside: WallMount | null = null
  let bestAny: WallMount | null = null
  for (const face of faces) {
    const dx = face.x2 - face.x1
    const dy = face.y2 - face.y1
    const len2 = dx * dx + dy * dy
    if (len2 === 0) continue
    const t = ((at.x - face.x1) * dx + (at.y - face.y1) * dy) / len2
    const tc = Math.min(1, Math.max(0, t))
    const px = face.x1 + dx * tc
    const py = face.y1 + dy * tc
    const offset = (at.x - px) * face.nx + (at.y - py) * face.ny
    const distance = Math.hypot(at.x - px, at.y - py)
    const mount: WallMount = {
      face,
      x: px,
      y: py,
      distance,
      withinSpan: t >= -spanTolerance && t <= 1 + spanTolerance,
      inside: offset >= -spanTolerance,
    }
    if (bestAny === null || distance < bestAny.distance) bestAny = mount
    if (mount.inside && mount.withinSpan && (bestInside === null || distance < bestInside.distance)) bestInside = mount
  }
  return bestInside ?? bestAny
}

/** 垂足相对墙段起点的比例（0~1），用于沿墙排布时错开位置 */
export function alongWallRatio(mount: WallMount): number {
  const dx = mount.face.x2 - mount.face.x1
  const dy = mount.face.y2 - mount.face.y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return 0
  return Math.min(1, Math.max(0, ((mount.x - mount.face.x1) * dx + (mount.y - mount.face.y1) * dy) / len2))
}

/** 内容坐标 → 该楼层局部平面坐标（-0.5~0.5），3D 与 2D 因此指向同一个位置 */
export function contentToLocal(content: { x: number; y: number }): { x: number; y: number } {
  return { x: content.x / VIEW_W, y: content.y / VIEW_H }
}
