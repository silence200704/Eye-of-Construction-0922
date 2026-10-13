/**
 * 楼栋的外部体量：外墙 + 每层窗带 + 屋顶女儿墙 + 入口雨篷（校园总览用）。
 *
 * 低多边形校园模型读起来像不像"楼"，主要看层高节奏、窗带是否成排、屋顶有没有处理过 ——
 * 这里只做这三件：不贴贴图、不导入外部模型，尺寸仍来自档案的程序化值。
 * 进单栋后改用剖层内部视图（sceneParts），供"选楼层看测点"。
 */
import * as THREE from "three"
import type { CampusModel } from "@/core/spatial/project"
import { labelSprite } from "./sceneText"
import { ROOF_TINT, eventColor, tintOf, type LevelDetail, type SceneUpdate } from "./sceneShared"

/** 每层窗带的高度与窗洞尺寸（世界单位）：低多边形体量模型靠"窗带节奏"被读成一栋楼 */
const WINDOW = { height: 1.05, width: 1.5, gap: 1.25, sill: 1.15 }
/** 楼栋外壳的墙厚、女儿墙高与屋顶厚度 */
const SHELL = { thickness: 0.28, parapet: 0.55, roof: 0.35, plinth: 0.5 }
import { levelGroup } from "./sceneParts"

/** 四面窗带与层间檐线：让低模楼体在斜视角下也能读出层数。 */
function addFacadeDetails(group: THREE.Group, world: { w: number; d: number }, floors: number, gym: boolean): void {
  const glass = new THREE.MeshStandardMaterial({ color: 0x416474, roughness: 0.32, metalness: 0.12 })
  const band = new THREE.MeshStandardMaterial({ color: 0xf4f7f4, roughness: 0.88 })
  const levels = gym ? 1 : floors
  for (let level = 0; level < levels; level += 1) {
    const y = SHELL.plinth + level * 4.2 + WINDOW.sill
    for (const face of ['front', 'side'] as const) {
      const span = face === 'front' ? world.w : world.d
      const rowWidth = span - 1.6
      const count = Math.max(2, Math.floor(rowWidth / (WINDOW.width + WINDOW.gap)))
      const step = rowWidth / count
      for (let i = 0; i < count; i += 1) {
        const offset = -rowWidth / 2 + step * (i + 0.5)
        for (const sign of [-1, 1]) {
          const window = new THREE.Mesh(
            new THREE.BoxGeometry(face === 'front' ? WINDOW.width : 0.13, WINDOW.height,
              face === 'front' ? 0.13 : WINDOW.width),
            glass,
          )
          window.position.set(face === 'front' ? offset : sign * (world.w / 2 + 0.08), y,
            face === 'front' ? sign * (world.d / 2 + 0.08) : offset)
          group.add(window)
        }
      }
    }
    if (level === 0 || gym) continue
    const belt = new THREE.Mesh(new THREE.BoxGeometry(world.w + 0.38, 0.12, world.d + 0.38), band)
    belt.position.y = SHELL.plinth + level * 4.2 - 0.18
    group.add(belt)
  }
}

/**
 * 单栋楼的**外部体量**（校园总览用）：外墙 + 每层窗带 + 屋顶女儿墙 + 入口雨篷。
 *
 * 低多边形校园模型读起来像不像"楼"，主要看三件事：层高节奏、窗带是否成排、
 * 屋顶有没有处理过（女儿墙/挑檐）。这里只做这三件，不贴贴图、不导入外部模型 ——
 * 几何仍由档案的程序化尺寸生成，进单栋后再换成剖层内部视图。
 */
function buildingShell(building: CampusModel['buildings'][number]): THREE.Group {
  const group = new THREE.Group()
  const { world } = building
  const floors = Math.max(1, building.levels.length)
  const height = floors * 4.2
  const tint = tintOf(building.building.code)
  // 体育馆是大跨单层：体量抬高、屋顶外挑，跟教学/办公楼的"多层窗带"区分开
  const gym = building.building.purpose === '体育'
  const bodyH = gym ? height + 2.6 : height
  const wallMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.94 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x33505c, roughness: 0.48 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xf3f5f2, roughness: 0.85 })

  // 基座
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(world.w + 0.5, SHELL.plinth, world.d + 0.5), trimMat)
  plinth.position.y = 0.25
  group.add(plinth)

  // 四面外墙（比体量略小一点，让基座露出来）
  for (const [w, d, dx, dz] of [
    [world.w, SHELL.thickness, 0, -world.d / 2],
    [world.w, SHELL.thickness, 0, world.d / 2],
    [SHELL.thickness, world.d, -world.w / 2, 0],
    [SHELL.thickness, world.d, world.w / 2, 0],
  ] as [number, number, number, number][]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, d), wallMat)
    wall.position.set(dx, bodyH / 2 + SHELL.plinth, dz)
    group.add(wall)
  }

  addFacadeDetails(group, world, floors, gym)

  // 屋顶：女儿墙 + 顶板；体育馆给一圈外挑檐口
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(world.w + (gym ? 1.8 : 0.6), SHELL.roof, world.d + (gym ? 1.8 : 0.6)),
    new THREE.MeshStandardMaterial({ color: ROOF_TINT, roughness: 0.82 }),
  )
  roof.position.y = bodyH + SHELL.plinth + 0.2
  group.add(roof)
  for (const [w, d, dx, dz] of [
    [world.w, 0.22, 0, -world.d / 2],
    [world.w, 0.22, 0, world.d / 2],
    [0.22, world.d, -world.w / 2, 0],
    [0.22, world.d, world.w / 2, 0],
  ] as [number, number, number, number][]) {
    const parapet = new THREE.Mesh(new THREE.BoxGeometry(w, SHELL.parapet, d), trimMat)
    parapet.position.set(dx, bodyH + SHELL.plinth + SHELL.roof / 2 + SHELL.parapet / 2, dz)
    group.add(parapet)
  }

  // 入口：正立面中间的门洞 + 雨篷（让人一眼知道从哪进）
  const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.3, 0.2), darkMat)
  door.position.set(0, SHELL.plinth + 1.15, world.d / 2 + 0.06)
  group.add(door)
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.24, 1.6), trimMat)
  canopy.position.set(0, SHELL.plinth + 2.5, world.d / 2 + 0.8)
  group.add(canopy)

  group.userData.kind = 'building'
  group.userData.buildingId = building.building.id
  return group
}

/** 外壳封顶后的高度：名字标签就挂在这之上 */
function shellTopOf(building: CampusModel['buildings'][number]): number {
  const h = Math.max(1, building.levels.length) * 4.2
  const gym = building.building.purpose === '体育'
  return (gym ? h + 2.6 : h) + SHELL.plinth + SHELL.parapet + 1.4
}

function buildingGroup(building: CampusModel['buildings'][number], update: SceneUpdate): THREE.Group {
  const group = new THREE.Group()
  const { world } = building
  group.position.set(world.cx, 0, world.cz)
  group.rotation.y = -world.rotation

  // 每栋楼有一块与自身 footprint 同朝向的展示台，只衬托轮廓，不改变 2D 对应位置。
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(world.w + 2.4, 0.2, world.d + 2.4),
    new THREE.MeshStandardMaterial({ color: 0xf9fbf8, roughness: 1 }),
  )
  pad.position.y = -0.04
  group.add(pad)
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(pad.geometry),
    new THREE.LineBasicMaterial({ color: tintOf(building.building.code), transparent: true, opacity: 0.88 }),
  )
  edge.position.copy(pad.position)
  group.add(edge)

  const focused = update.scope.kind === 'building' && update.scope.buildingId === building.building.id
  let nameHeight = shellTopOf(building)
  const detail: LevelDetail = {
    zoneLabels: focused && update.mode === 'floor',
    deviceLabels: focused,
  }

  const height = Math.max(1, building.levels.length) * 4.2
  if (focused) {
    // 进单栋：剖层内部（楼板 + 分区 + 贴墙的传感器），供"选楼层看测点"
    for (const level of building.levels) group.add(levelGroup(level, building, update, detail))
  } else {
    // 校园总览：用外部体量模型，四栋才各自读成一栋楼
    group.add(buildingShell(building))
    const shellHeight = (building.building.purpose === '体育' ? height + 2.6 : height) + SHELL.plinth + SHELL.parapet
    nameHeight = shellHeight + (eventColor(building.maxEventLevel) === null ? 1.4 : 4.4)
  }
  const badge = eventColor(building.maxEventLevel)
  if (badge !== null) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.4, 2.6, 16),
      new THREE.MeshLambertMaterial({ color: badge }),
    )
    cone.position.y = height + 3.4
    cone.rotation.x = Math.PI
    cone.userData.kind = 'badge'
    cone.userData.buildingId = building.building.id
    group.add(cone)
  }

  const name = labelSprite({
    text: `${building.building.code} ${building.building.name}`,
    height: focused ? 1.55 : 1.65,
    color: '#16232a',
    background: '#ffffff',
  })
  name.position.set(0, nameHeight, 0)
  group.add(name)
  return group
}

export { buildingGroup }
