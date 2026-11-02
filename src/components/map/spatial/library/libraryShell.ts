/**
 * 龙子湖校区图书馆外观（校园总览专用）。
 *
 * Blender GLB 不可用时的程序化兜底：厚重灰色石材外框 + 中央深凹的通高玻璃中庭 +
 * 层间横向楼板带 + 两端竖向石肋，入口在中央凹口底部。
 * 正常路径加载 `public/models/library-longzihu.glb`；这里只在 WebGL 加载失败时使用。
 */
import * as THREE from "three"
import { FLOOR_HEIGHT } from "@/core/spatial/coordinates"
import type { CampusModel } from "@/core/spatial/project"
import { labelSprite } from "../sceneText"

const STONE = 0xb9b8b1
const STONE_DARK = 0x8f8d86
const STONE_LIGHT = 0xd2d0c6
const GLASS = 0x5d7d8c
const DARK_GLASS = 0x24373d
const ROOF = 0x667377

function box(size: [number, number, number], position: [number, number, number], material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position)
  return mesh
}

/** 深凹的中央玻璃中庭：玻璃退到外框后面，前面留出檐下阴影。 */
function atrium(group: THREE.Group, world: { w: number; d: number }, height: number, plinth: number): void {
  const width = world.w * 0.54
  const top = plinth + height - 1.9
  const bottom = plinth + 1.15
  const wallHeight = top - bottom
  const z = world.d / 2 - 2.25
  const glass = new THREE.MeshPhysicalMaterial({
    color: GLASS, roughness: 0.1, metalness: 0.25, transparent: true, opacity: 0.62,
    clearcoat: 0.95, clearcoatRoughness: 0.12, side: THREE.DoubleSide,
  })
  const dark = new THREE.MeshStandardMaterial({ color: DARK_GLASS, roughness: 0.8 })
  const frame = new THREE.MeshStandardMaterial({ color: STONE_LIGHT, roughness: 0.68 })
  const stoneDark = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.9 })

  // 深色内衬让凹口在远处也读成一个有纵深的洞，而不是贴在墙上的玻璃
  group.add(box([width, wallHeight, 0.3], [0, bottom + wallHeight / 2, z - 1.1], dark))
  group.add(box([width, wallHeight, 0.18], [0, bottom + wallHeight / 2, z], glass))

  // 竖向分格与每层横向楼板带：实景里最醒目的节奏
  for (let column = 0; column <= 9; column += 1) {
    group.add(box([0.08, wallHeight, 0.16], [-width / 2 + (width / 9) * column, bottom + wallHeight / 2, z + 0.12], frame))
  }
  for (let floor = 1; floor < Math.max(2, Math.round(height / FLOOR_HEIGHT)); floor += 1) {
    const y = plinth + floor * FLOOR_HEIGHT
    if (y < top - 0.3) group.add(box([width + 0.6, 0.38, 2.5], [0, y, world.d / 2 - 1.0], frame))
  }
  // 凹口侧壁与顶部的石材回边，让玻璃“退进去”
  for (const x of [-width / 2 - 0.25, width / 2 + 0.25]) {
    group.add(box([0.5, wallHeight + 0.6, 2.4], [x, bottom + wallHeight / 2, world.d / 2 - 1.05], stoneDark))
  }
  group.add(box([width + 1.0, 0.5, 2.4], [0, top + 0.25, world.d / 2 - 1.05], stoneDark))
  group.add(box([width + 0.8, 0.5, 2.4], [0, bottom - 0.25, world.d / 2 - 1.05], stoneDark))
}

/**
 * 南侧主入口：实景从大台阶上到二层平台再进门，一层另设西侧门。
 * 这里把二层平台、宽台阶和门斗画出来，不把入口误做成地面门洞。
 */
function entrance(group: THREE.Group, world: { w: number; d: number }, plinth: number): void {
  const trim = new THREE.MeshStandardMaterial({ color: STONE_LIGHT, roughness: 0.72 })
  const base = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.92 })
  const door = new THREE.MeshStandardMaterial({ color: DARK_GLASS, roughness: 0.18, metalness: 0.35 })
  const level = plinth + FLOOR_HEIGHT
  const doorWidth = world.w * 0.3
  // 二层入口平台与下方实体基座
  group.add(box([world.w * 0.64, 0.45, 4.8], [0, level - 0.22, world.d / 2 + 1.8], trim))
  group.add(box([world.w * 0.64, level - 0.4, 3.6], [0, (level - 0.4) / 2, world.d / 2 + 1.6], base))
  // 二层玻璃门与门框
  group.add(box([doorWidth, 3.0, 0.25], [0, level + 1.5, world.d / 2 - 1.45], door))
  for (const x of [-0.16, -0.05, 0.05, 0.16]) {
    group.add(box([0.16, 3.0, 0.3], [x * world.w, level + 1.5, world.d / 2 - 1.38], trim))
  }
  group.add(box([doorWidth, 0.14, 0.9], [0, level + 3.05, world.d / 2 - 1.2], trim))
  // 宽台阶：从地面逐级上到二层平台
  for (let step = 0; step < 7; step += 1) {
    const top = level - 0.15 - step * 0.6
    group.add(box([world.w * 0.6, 0.6, 0.9], [0, top - 0.3, world.d / 2 + 4.0 + step * 0.82], trim))
  }
}

/** 两侧实体墙垛的窄窗 + 右侧整排竖向石肋。 */
function sideDetails(group: THREE.Group, world: { w: number; d: number }, floors: number, height: number, plinth: number): void {
  const glass = new THREE.MeshStandardMaterial({ color: 0x314b57, roughness: 0.22, metalness: 0.25 })
  const stone = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.88 })
  for (let floor = 0; floor < floors; floor += 1) {
    const y = plinth + 1.85 + floor * FLOOR_HEIGHT
    for (const x of [-0.36, -0.28, 0.28, 0.36]) {
      group.add(box([0.34, 1.55, 0.14], [x * world.w, y, world.d / 2 + 0.08], glass))
    }
  }
  // 右侧深色玻璃带 + 一排竖向石肋（实景右侧的柱廊感）
  group.add(box([0.18, height - 2.4, world.d * 0.72], [world.w / 2 + 0.04, plinth + (height - 2.4) / 2, 0], glass))
  for (let fin = 0; fin < 9; fin += 1) {
    const z = -world.d * 0.35 + (world.d * 0.7 / 8) * fin
    group.add(box([0.55, height - 1.8, 0.2], [world.w / 2 + 0.18, plinth + (height - 1.8) / 2, z], stone))
  }
}

/** 顶部厚檐、女儿墙与小型屋顶设备。 */
function crown(group: THREE.Group, world: { w: number; d: number }, height: number, plinth: number): void {
  const roof = new THREE.MeshStandardMaterial({ color: ROOF, roughness: 0.8 })
  const trim = new THREE.MeshStandardMaterial({ color: STONE_LIGHT, roughness: 0.74 })
  group.add(box([world.w + 0.9, 1.5, world.d + 0.4], [0, plinth + height - 0.75, 0], roof))
  group.add(box([world.w + 1.1, 0.24, world.d + 0.6], [0, plinth + height + 0.2, 0], trim))
  for (const [w, d, x, z] of [
    [world.w + 0.9, 0.22, 0, -world.d / 2],
    [world.w + 0.9, 0.22, 0, world.d / 2],
    [0.22, world.d + 0.4, -world.w / 2, 0],
    [0.22, world.d + 0.4, world.w / 2, 0],
  ] as [number, number, number, number][]) {
    group.add(box([w, 0.55, d], [x, plinth + height + 0.45, z], trim))
  }
  group.add(box([world.w * 0.2, 0.9, world.d * 0.18], [-world.w * 0.2, plinth + height + 1.0, -world.d * 0.1], trim))
}

/** 基座与前场铺装；用户要求只保留建筑，不做树木/绿篱。 */
function forecourt(group: THREE.Group, world: { w: number; d: number }, plinth: number): void {
  const stoneDark = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.92 })
  group.add(box([world.w + 5.0, 0.12, world.d + 5.0], [0, 0.08, 1.0],
    new THREE.MeshStandardMaterial({ color: 0xe5e1d4, roughness: 0.95 })))
  group.add(box([world.w + 0.9, plinth, world.d + 0.9], [0, plinth / 2, 0], stoneDark))
}

export function libraryShell(building: CampusModel['buildings'][number]): THREE.Group {
  const group = new THREE.Group()
  const { world } = building
  const floors = Math.max(1, building.levels.length)
  const height = floors * FLOOR_HEIGHT
  const plinth = 0.55
  const stone = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.86, metalness: 0.03 })
  const stoneDark = new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.92 })

  forecourt(group, world, plinth)

  // 主体：厚重的石材外框（两侧实体墙垛 + 顶部厚檐）
  group.add(box([world.w, height, world.d * 0.88], [0, plinth + height / 2, -world.d * 0.06], stone))
  group.add(box([world.w * 0.23, height, world.d], [-world.w * 0.385, plinth + height / 2, 0], stone))
  group.add(box([world.w * 0.23, height, world.d], [world.w * 0.385, plinth + height / 2, 0], stone))
  group.add(box([world.w + 1.2, 1.7, world.d + 0.9], [0, plinth + height - 0.85, 0], stone))

  atrium(group, world, height, plinth)
  entrance(group, world, plinth)
  sideDetails(group, world, floors, height, plinth)
  crown(group, world, height, plinth)

  // 校名与竖排馆名：金色贴在深灰石材上，近看可读，远看是两笔暖色
  const plaque = box([world.w * 0.42, 1.2, 0.16], [0, plinth + height - 0.9, world.d / 2 + 0.62], stoneDark)
  group.add(plaque)
  const university = labelSprite({ text: '河南牧业经济学院', height: 1.6, color: '#f5d98f', fontFamily: 'STSong, SimSun, serif' })
  university.position.set(0, plinth + height - 0.9, world.d / 2 + 0.76)
  university.userData.kind = 'building'
  group.add(university)
  const name = labelSprite({ text: '图书馆', height: 2.3, color: '#f5d98f', fontFamily: 'STSong, SimSun, serif' })
  name.position.set(world.w * 0.385, plinth + height * 0.58, world.d / 2 + 0.5)
  name.userData.kind = 'building'
  group.add(name)

  group.userData.kind = 'building'
  group.userData.buildingId = building.building.id
  return group
}

export function isLibrary(building: Pick<CampusModel['buildings'][number]['building'], 'purpose' | 'code'>): boolean {
  return building.purpose.includes('图书馆') || building.code === 'B05'
}
