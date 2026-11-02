/**
 * 把 Blender 导出的楼栋 GLB 克隆并缩放到档案 footprint。
 *
 * 所有模型在 Blender 里以“正面朝 -Y”建模，导出时 Y-up 后正面朝 +Z；
 * campus 坐标的朝向仍由 buildingGroup 的 rotation 控制，这里只做尺寸与落地。
 */
import * as THREE from 'three'
import type { CampusModel } from '@/core/spatial/project'

type Building = CampusModel['buildings'][number]

function targetHeightOf(building: Building): number {
  const floors = Math.max(1, building.levels.length)
  const height = floors * 4.2
  // 体育馆是大跨单层，现有程序化外壳也抬高 2.6；自定义模型保持同一取景口径
  return building.building.purpose === '体育' ? height + 2.6 : height
}

/** 深拷贝模板并归一化到楼栋 footprint；几何与材质必须克隆，重绘时才能安全释放。 */
export function modelFromTemplate(building: Building, template: THREE.Object3D): THREE.Object3D {
  const model = template.clone(true)
  model.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.isMesh !== true) return
    mesh.geometry = mesh.geometry.clone()
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((row) => row.clone())
      : mesh.material.clone()
    mesh.castShadow = true
    mesh.receiveShadow = true
  })

  const bounds = new THREE.Box3().setFromObject(model)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const depthBasis = typeof template.userData.depthBasis === 'number' && template.userData.depthBasis > 0
    ? template.userData.depthBasis
    : size.z
  const scaleX = building.world.w / Math.max(0.001, size.x)
  const scaleY = targetHeightOf(building) / Math.max(0.001, size.y)
  const scaleZ = building.world.d / Math.max(0.001, depthBasis)
  model.scale.set(scaleX, scaleY, scaleZ)
  // 有 depthBasis 时只把建筑主体放进 footprint，让门厅/台阶自然伸到前场；
  // 无 depthBasis 时仍按整体包围盒居中，避免普通楼栋偏出展示台。
  const centerZ = depthBasis === size.z ? center.z : 0
  model.position.set(-center.x * scaleX, -bounds.min.y * scaleY, -centerZ * scaleZ)
  model.userData.kind = 'building'
  model.userData.buildingId = building.building.id
  return model
}
