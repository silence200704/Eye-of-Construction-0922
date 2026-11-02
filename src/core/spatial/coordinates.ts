/**
 * 空间坐标换算（纯函数）：归一化平面 → 楼栋局部 → 校园世界，以及反向还原。
 *
 * 三种坐标各自的含义：
 * - **归一化**：`Point.coord` 与 `layout.ts` 的内容坐标同尺度（0~1，原点在平面图左上）；
 * - **楼栋局部**：以楼栋中心为原点、取值为 -0.5~0.5 的平面坐标（x 东西、z 南北）；
 * - **校园世界**：X 东西、Y 竖直向上、Z 南北，单位是演示刻度（不是实测米数）。
 *
 * 反向换算（世界 → 局部 → 归一化）用于"点中的是哪个测点/哪一层"的校验，
 * 必须与正向严格互逆——两处各写一套三角函数就是错位与选中跑偏的来源。
 */
import type { Footprint, NormPoint } from '@/types/domain'

/** 校园平面演示尺度（世界单位）；只影响观感比例，不代表实测尺寸 */
export const CAMPUS_W = 100
export const CAMPUS_D = 70
/** 演示层高（世界单位），与 §15 的"统一演示层高"一致 */
export const FLOOR_HEIGHT = 4.2
/** 地面抬升：让楼栋略高于场地网格，避免与地面 z-fighting */
export const BASE_Y = 0.5

export interface BuildingWorld {
  /** 楼栋中心在校园平面上的位置 */
  cx: number
  cz: number
  /** 楼栋平面尺寸（世界单位） */
  w: number
  d: number
  /** 朝向（弧度，与 footprint.rotate 的度数对应） */
  rotation: number
}

const DEG_TO_RAD = Math.PI / 180

/** 楼栋档案（归一化占位）→ 校园世界摆放 */
export function buildingWorld(footprint: Footprint): BuildingWorld {
  return {
    cx: (footprint.x - 0.5) * CAMPUS_W,
    cz: (footprint.y - 0.5) * CAMPUS_D,
    w: footprint.w * CAMPUS_W,
    d: footprint.h * CAMPUS_D,
    rotation: footprint.rotate * DEG_TO_RAD,
  }
}

/** 归一化平面坐标 → 楼栋局部（-0.5~0.5）；与朝无关，先做的是"平面图上的相对位置" */
export function localOf(coord: NormPoint): { x: number; z: number } {
  return { x: coord.x - 0.5, z: coord.y - 0.5 }
}

/** 楼栋局部 → 校园世界（含朝向旋转与平移）；y 由调用方给（见 `levelY`） */
export function toWorld(
  building: BuildingWorld,
  local: { x: number; z: number },
  y: number,
): { x: number; y: number; z: number } {
  const u = local.x * building.w
  const v = local.z * building.d
  const cos = Math.cos(building.rotation)
  const sin = Math.sin(building.rotation)
  return {
    x: building.cx + u * cos - v * sin,
    y,
    z: building.cz + u * sin + v * cos,
  }
}

/** 校园世界 → 楼栋局部（`toWorld` 的逆运算，选中校验靠它） */
export function toLocal(building: BuildingWorld, world: { x: number; z: number }): { x: number; z: number } {
  const dx = world.x - building.cx
  const dz = world.z - building.cz
  const cos = Math.cos(building.rotation)
  const sin = Math.sin(building.rotation)
  const u = dx * cos + dz * sin
  const v = -dx * sin + dz * cos
  return { x: building.w === 0 ? 0 : u / building.w, z: building.d === 0 ? 0 : v / building.d }
}

/** 楼栋局部 → 归一化平面坐标（`localOf` 的逆运算） */
export function normalizedOf(local: { x: number; z: number }): NormPoint {
  return { x: local.x + 0.5, y: local.z + 0.5 }
}

/** 第几层（0 起）的楼板顶面标高 */
export function levelY(levelIndex: number): number {
  return BASE_Y + levelIndex * FLOOR_HEIGHT
}

/** 楼层竖向展开时，每层额外抬起的距离（"竖向展开"视图用，仍保持层序可见） */
export const LEVEL_EXPLODE_STEP = 2.6

/** 展开视图下第几层要额外抬多少（不展开时为 0）；展开规则只此一处，2D/3D 都读它 */
export function explodeOffsetOf(levelIndex: number, exploded: boolean): number {
  return exploded ? levelIndex * LEVEL_EXPLODE_STEP : 0
}

/** 局部坐标是否落在楼栋平面内（留一点容差，边界上的点算在内） */
export function isInsideBuilding(local: { x: number; z: number }, tolerance = 0.02): boolean {
  return Math.abs(local.x) <= 0.5 + tolerance && Math.abs(local.z) <= 0.5 + tolerance
}

/**
 * 建议安装高度（世界单位，1 单位约当 1 米量级的演示刻度）。
 *
 * 按设备安装惯例取值：房间类仪器（温湿度）装在人可读的墙面高度（1.2–1.6 m）；
 * 裂缝计、倾角计这类**测结构变形**的传感器装在靠近构件根部/中部（0.5–0.8 m），
 * 因为裂缝开展与倾斜在靠近节点处最敏感。演示里按指标类型给固定值，不逐点编数字。
 */
const MOUNT_HEIGHT_BY_TYPE: Record<string, number> = {
  crack: 0.55,
  tilt: 0.65,
  vibration: 0.8,
  temp_humidity: 1.55,
  manual_check: 1.45,
}
const MOUNT_HEIGHT_FALLBACK = 0.8

export function mountHeightOf(pointType: string): number {
  return MOUNT_HEIGHT_BY_TYPE[pointType] ?? MOUNT_HEIGHT_FALLBACK
}

/** 测点离最近墙面超过这个距离（内容坐标单位，平面宽 1000）就不再硬凑到墙上 */
/** 测点离最近墙面超过这个距离（内容坐标单位，平面宽 1000）就不再硬凑到墙上；走廊放宽后留出余量 */
export const MAX_MOUNT_DISTANCE = 100
