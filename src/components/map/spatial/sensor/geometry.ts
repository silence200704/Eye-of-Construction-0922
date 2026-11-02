/**
 * 墙体测点的展示几何。墙体位置仍由 core/spatial 的 2D 投影决定。
 * 外露识别面与选中后的透视芯体只是位置示意，不代表实际设备型号或埋深。
 */
import * as THREE from 'three'
import type { LevelModel } from '@/core/spatial/project'
import { contentToLocal } from '@/core/spatial/layout'

type Marker = LevelModel['markers'][number]
type World = { w: number; d: number }

function sensorFace(group: THREE.Group, color: number, type: string): void {
  const metal = new THREE.MeshStandardMaterial({ color: 0xdfe9e8, metalness: 0.28, roughness: 0.42 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x183d46, roughness: 0.55 })
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b2730, metalness: 0.35, roughness: 0.2 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a44c, metalness: 0.55, roughness: 0.35 })
  const white = new THREE.MeshStandardMaterial({ color: 0xf1f0e9, roughness: 0.55 })
  const accent = new THREE.MeshBasicMaterial({ color })
  const add = (mesh: THREE.Mesh, z = 0): void => { mesh.position.z += z; group.add(mesh) }
  const screw = (x: number, y: number): void => {
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.022, 10), metal)
    bolt.rotation.x = Math.PI / 2
    bolt.position.set(x, y, 0.12)
    group.add(bolt)
  }

  add(new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.94, 0.045), metal), 0.04)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.012), dark), 0.078)
  ;[-0.34, 0.34].forEach((x) => { screw(x, 0.4); screw(x, -0.4) })

  if (type === 'tilt') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.09, 32), metal)
    disc.rotation.x = Math.PI / 2
    disc.position.z = 0.09
    group.add(disc)
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 32), glass)
    lens.rotation.x = Math.PI / 2
    lens.position.z = 0.145
    group.add(lens)
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.022, 8, 32), gold)
    bezel.position.z = 0.158
    group.add(bezel)
    const bubble = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.065, 0.018), white)
    bubble.position.set(-0.02, -0.19, 0.16)
    group.add(bubble)
  } else if (type === 'crack') {
    for (const side of [-1, 1]) {
      const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.38, 0.025), gold)
      anchor.position.set(side * 0.26, 0, 0.1)
      group.add(anchor)
      screw(side * 0.26, 0.12); screw(side * 0.26, -0.12)
    }
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.055, 0.012), accent)
    slot.position.z = 0.115
    group.add(slot)
    const crack = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.3, 0.012), white)
    crack.position.set(0.05, 0, 0.12)
    crack.rotation.z = -0.24
    group.add(crack)
  } else if (type === 'vibration') {
    for (let fin = 0; fin < 4; fin += 1) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.028, 0.025), metal)
      rib.position.set(0, 0.16 - fin * 0.08, 0.105)
      group.add(rib)
    }
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.015), glass)
    screen.position.set(-0.08, -0.22, 0.115)
    group.add(screen)
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.018, 16), gold)
    button.rotation.x = Math.PI / 2
    button.position.set(0.21, -0.22, 0.12)
    group.add(button)
  } else if (type === 'temp_humidity') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.8, 0.06), white)
    body.position.z = 0.07
    group.add(body)
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.012), glass)
    screen.position.set(0, 0.22, 0.11)
    group.add(screen)
    for (let slot = 0; slot < 5; slot += 1) {
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.022, 0.012), dark)
      grille.position.set(0, -0.03 - slot * 0.07, 0.11)
      group.add(grille)
    }
  } else if (type === 'manual_check') {
    const tag = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.86, 0.035), gold)
    tag.position.z = 0.075
    group.add(tag)
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.012), white)
    face.position.z = 0.1
    group.add(face)
    for (let ring = 0; ring < 3; ring += 1) {
      const wave = new THREE.Mesh(new THREE.TorusGeometry(0.1 + ring * 0.06, 0.012, 8, 24), new THREE.MeshBasicMaterial({ color: 0x0b7d86 }))
      wave.position.set(0, 0.12, 0.115)
      group.add(wave)
    }
  }

  const status = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), accent)
  status.position.set(0.27, 0.34, 0.13)
  group.add(status)
  const statusRing = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.015, 6, 24), accent)
  statusRing.position.set(0.27, 0.34, 0.135)
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
    sensorFace(device, color, marker.point.type)
    if (selected) {
      // 选中设备略探出墙面并放大：保持安装位置，同时让 3D 面板细节可见。
      device.translateZ(0.14)
      device.scale.setScalar(1.28)
      interiorReveal(device, color)
    }
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
