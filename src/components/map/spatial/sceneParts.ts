/**
 * 单栋楼的**内部**几何：楼板、区域色块与隔墙、贴墙安装的传感器。
 *
 * 只管"画成什么样"：位置与高度来自 core/spatial 的投影，事件颜色由上层传入。
 * 楼栋外壳在 sceneShell.ts，引擎（相机/拾取/取景/释放）在 sceneBuild.ts。
 */
import * as THREE from "three"
import type { CampusModel, LevelModel } from "@/core/spatial/project"
import { explodeOffsetOf } from "@/core/spatial/coordinates"
import { contentToLocal, zoneCenter } from "@/core/spatial/layout"
import { labelSprite } from "./sceneText"
import { sensorMount } from './sensor/geometry'
import {
  MARKER_COLOR,
  SELECTED,
  eventColor,
  tintOf,
  type LevelDetail,
  type SceneUpdate,
  type ViewMode,
} from "./sceneShared"

/** 一块楼板 + 四周矮墙（楼层轮廓），不含区域细节 */

/** 区域色块：把 2D 平面图的区域框映射到楼栋局部平面，画成一块很矮的"地面分区" */
function zoneBlock(
  local: { x: number; z: number; w: number; d: number },
  color: number,
  y: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(local.w, 0.12, local.d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
  )
  mesh.position.set(local.x, y + 0.16, local.z)
  mesh.userData.kind = 'zone'
  return mesh
}

/** 区域隔墙：沿区域框的四条边画很薄的墙，让分区看得出来 */
function zoneWalls(local: { x: number; z: number; w: number; d: number }, y: number, height: number): THREE.Group {
  const group = new THREE.Group()
  const material = new THREE.MeshStandardMaterial({ color: 0x9fb9bd, roughness: 0.93 })
  const along: [number, number, number, number][] = [
    [local.w, 0.12, 0, -local.d / 2],
    [local.w, 0.12, 0, local.d / 2],
    [0.12, local.d, -local.w / 2, 0],
    [0.12, local.d, local.w / 2, 0],
  ]
  for (const [w, d, dx, dz] of along) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), material)
    wall.position.set(local.x + dx, y + height / 2 + 0.2, local.z + dz)
    group.add(wall)
  }
  group.userData.kind = 'walls'
  return group
}

/** 当前层的墙高与其余层的矮墙高度：前者让传感器有真实的墙面可贴，后者保证整栋仍看得进去 */
const WALL_HEIGHT_ACTIVE = 2.8
const WALL_HEIGHT_OTHER = 0.5
/** 判断某层在当前视图下是否可见（仅本层只留一层；整栋与展开都显示全部） */
function levelVisible(mode: ViewMode, levelIndex: number, activeLevelIndex: number): boolean {
  return mode !== 'floor' || levelIndex === activeLevelIndex
}

/** 层在展开视图下的额外抬升（规则在 `core/spatial/coordinates`，2D/3D 共用一个口径） */
function explodeOffset(mode: ViewMode, levelIndex: number): number {
  return explodeOffsetOf(levelIndex, mode === 'exploded')
}


/** 把一个楼层模型画成一组网格（楼板 + 区域 + 墙面 + 贴墙的测点） */
function levelGroup(
  level: LevelModel,
  building: CampusModel['buildings'][number],
  update: SceneUpdate,
  detail: LevelDetail,
): THREE.Group {
  const group = new THREE.Group()
  const { world } = building
  const active = level.levelIndex === update.activeLevelIndex
  const offset = explodeOffset(update.mode, level.levelIndex)
  group.position.y = offset

  // 仅本层模式：其余层画成半透明的"幽灵楼板"而不是直接隐藏 ——
  // 整栋的体量还在，观众不会失去上下文的方位感（隔离用"变淡"而不是"删除"）。
  const ghost = update.mode === 'floor' && !active
  const visible = levelVisible(update.mode, level.levelIndex, update.activeLevelIndex)
  group.visible = visible
  if (!visible) return group

  const tint = tintOf(building.building.code)
  const slabMat = ghost
    ? new THREE.MeshLambertMaterial({ color: 0xdfe7ea, transparent: true, opacity: 0.16, depthWrite: false })
    : new THREE.MeshStandardMaterial({ color: active ? tint : 0xeaf0ef, roughness: 0.95 })
  const slab = new THREE.Mesh(new THREE.BoxGeometry(world.w, 0.3, world.d), slabMat)
  slab.position.y = level.y
  slab.userData.kind = 'slab'
  group.add(slab)
  if (ghost) return group

  // 当前层用满高墙（贴墙的传感器要有墙可贴），其余层用矮墙，整栋仍看得进去
  const wallHeight = active ? WALL_HEIGHT_ACTIVE : WALL_HEIGHT_OTHER

  // 区域：从共享布局取框，映射到楼栋局部平面（与 2D 平面图同一份几何）
  if (level.floor !== null) {
    for (const zone of level.layout.zones) {
      const center = contentToLocal(zoneCenter(zone))
      const local = {
        x: (center.x - 0.5) * world.w,
        z: (center.y - 0.5) * world.d,
        w: (zone.box.w / 1000) * world.w,
        d: (zone.box.h / 700) * world.d,
      }
      const isCorridor = zone.kind === 'corridor'
      group.add(zoneBlock(local, isCorridor ? 0xbdd8dd : zone.stairs ? 0xdce5d5 : 0xf5f5ed, level.y))
      // 走廊两侧是敞开的，只给房间画墙；当前层用满高墙（贴墙的测点要有墙可贴）
      if (!isCorridor) group.add(zoneWalls(local, level.y, wallHeight))
      if (detail.zoneLabels) {
        const label = labelSprite({ text: zone.label, height: 0.72, color: '#24434c', background: '#ffffff' })
        label.position.set(local.x, level.y + wallHeight + 0.5, local.z)
        group.add(label)
      }
    }
  }
  // 当前层的走廊两侧也补上满高墙：它是传感器最常挂的那面墙
  if (active && level.floor !== null) {
    const corridor = level.layout.corridor
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x92b3ba, roughness: 0.93 })
    const width = (corridor.w / 1000) * world.w
    const centerX = ((corridor.x + corridor.w / 2) / 1000 - 0.5) * world.w
    for (const contentY of [corridor.y, corridor.y + corridor.h]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, 0.12), wallMat)
      wall.position.set(centerX, level.y + wallHeight / 2 + 0.2, (contentY / 700 - 0.5) * world.d)
      group.add(wall)
    }
  }

  for (const marker of level.markers) {
    const color = marker.archived
      ? 0xb9c4c9
      : eventColor(marker.eventLevel) ?? MARKER_COLOR[marker.point.type] ?? 0x5a6b73
    const { device, labelAt } = sensorMount(marker, level.y, world, color, marker.point.id === update.selectedPointId)
    // 整组都算这个测点：点击墙面识别面、透视轮廓或拾取代理都能选中。
    device.userData.kind = 'marker'
    device.userData.pointId = marker.point.id
    device.userData.buildingId = building.building.id
    device.userData.floorId = level.floor?.id ?? ''
    group.add(device)
    if (marker.point.id === update.selectedPointId) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(1.05, 16, 12),
        new THREE.MeshBasicMaterial({ color: SELECTED, transparent: true, opacity: 0.16, depthWrite: false }),
      )
      halo.position.copy(device.position)
      group.add(halo)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.95, 0.14, 8, 24),
        new THREE.MeshBasicMaterial({ color: SELECTED }),
      )
      ring.position.copy(device.position)
      ring.position.y -= marker.mountHeight / 2.4
      ring.rotation.x = Math.PI / 2
      group.add(ring)
    }
    const code = detail.deviceLabels
      ? labelSprite({
        text: marker.point.code,
        height: marker.point.id === update.selectedPointId ? 0.9 : 0.76,
        color: eventColor(marker.eventLevel) === null ? '#15464f' : '#8c2f22',
        background: marker.point.id === update.selectedPointId ? '#d9f2ef' : '#ffffff',
      })
      : null
    if (code !== null) {
      code.position.set(labelAt.x, labelAt.y, labelAt.z)
      code.userData.kind = 'marker'
      code.userData.pointId = marker.point.id
      code.userData.buildingId = building.building.id
      code.userData.floorId = level.floor?.id ?? ''
      group.add(code)
    }

    // 选中时在编号下面再挂一行**实时信息**（读数 + 采样时间），由上层从与事实卡同源的快照传入
    if (marker.point.id === update.selectedPointId && update.selectedSummary !== '') {
      const summary = labelSprite({ text: update.selectedSummary, height: 0.62, color: '#0b5762', background: '#ffffff' })
      summary.position.set(labelAt.x, labelAt.y - 0.62, labelAt.z)
      summary.userData.kind = 'marker'
      summary.userData.pointId = marker.point.id
      group.add(summary)
    }
  }

  return group
}

/** 一栋楼：按楼层堆叠；校园视图下只画体量与层线，进入楼栋后才画区域细节 */
/**
 * 画一栋楼：**任何层级都用真实的逐层几何**（楼板 + 区域 + 隔墙 + 贴墙的测点）。
 *
 * 校园总览与单栋视图的区别只在"细节量"，不是"盒子还是模型"：
 * 校园总览要像 2D 校园图那样按 footprint 认出四栋在哪、各自长什么样，
 * 所以那里也照常画房间隔墙，只是用矮墙、不挂区域与测点文字，免得四栋一起变成一片字。
 */

export { levelGroup, levelVisible, explodeOffset }
