/**
 * 墙体测点的展示几何。墙体位置仍由 core/spatial 的 2D 投影决定。
 * 外露识别面与选中后的透视芯体只是位置示意，不代表实际设备型号或埋深。
 */
import * as THREE from 'three'
import type { LevelModel } from '@/core/spatial/project'
import { contentToLocal } from '@/core/spatial/layout'

type Marker = LevelModel['markers'][number]
type World = { w: number; d: number }

function surfaceFace(group: THREE.Group, color: number): void {
  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(0.76, 0.84, 0.025),
    new THREE.MeshStandardMaterial({ color: 0xe0e9e8, metalness: 0.22, roughness: 0.5 }),
  )
  rim.position.z = 0.075
  group.add(rim)

  const recess = new THREE.Mesh(
    new THREE.BoxGeometry(0.61, 0.68, 0.01),
    new THREE.MeshStandardMaterial({ color: 0x183d46, roughness: 0.82 }),
  )
  recess.position.z = 0.094
  group.add(recess)

  const status = new THREE.Mesh(
    new THREE.CircleGeometry(0.135, 24),
    new THREE.MeshBasicMaterial({ color }),
  )
  status.position.z = 0.103
  group.add(status)
  const statusRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.235, 0.02, 6, 28),
    new THREE.MeshBasicMaterial({ color }),
  )
  statusRing.position.z = 0.105
  group.add(statusRing)
}

function interiorReveal(group: THREE.Group, color: number): void {
  // 仅选中时叠加透视示意；不在真实墙体开洞，也不把芯体冒充实测埋深。
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9, 1, 0.18)),
    new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }),
  )
  outline.renderOrder = 8
  group.add(outline)
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.42, 0.07),
    new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.58 }),
  )
  core.position.z = -0.012
  core.renderOrder = 9
  group.add(core)
}

function unplacedMarker(group: THREE.Group, color: number): void {
  // 没找到可取用墙面时只标平面位置，不画成墙内安装。
  const pin = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.34, 1),
    new THREE.MeshStandardMaterial({ color, metalness: 0.16, roughness: 0.48 }),
  )
  group.add(pin)
}

export function sensorMount(
  marker: Marker,
  levelY: number,
  world: World,
  color: number,
  selected: boolean,
): { device: THREE.Group; labelAt: { x: number; y: number; z: number } } {
  const mount = marker.mount
  const anchor = mount === null ? marker.local : {
    x: contentToLocal({ x: mount.x, y: mount.y }).x - 0.5,
    z: contentToLocal({ x: mount.x, y: mount.y }).y - 0.5,
  }
  const nx = mount?.nx ?? 0
  const nz = mount?.ny ?? 0
  const device = new THREE.Group()
  // 不再沿墙面法线把整台设备推到墙外：组原点就是墙体中面。
  device.position.set(anchor.x * world.w, levelY + marker.mountHeight, anchor.z * world.d)
  if (mount !== null) {
    device.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, 0, nz).normalize())
    surfaceFace(device, color)
    if (selected) interiorReveal(device, color)
  } else {
    unplacedMarker(device, color)
  }

  // 拾取代理可命中但不遮挡；标签也是独立拾取入口。
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 10, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  )
  proxy.position.z = mount === null ? 0 : 0.35
  device.add(proxy)
  return {
    device,
    labelAt: {
      x: device.position.x + (mount === null ? 1.1 : nx * 1.15),
      y: device.position.y + 0.92,
      z: device.position.z + (mount === null ? 0 : nz * 1.15),
    },
  }
}
