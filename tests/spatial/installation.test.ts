import { describe, expect, it } from 'vitest'
import { installationViewOf } from '@/core/spatial/installation'
import { buildCampusModel, locatePoint } from '@/core/spatial/project'
import { seedBuildings, seedDevices, seedFloors, seedPoints } from '@/db/seedArchive'
import { P_TILT, P_VIB } from '@/db/seedFactories'

const model = buildCampusModel({ buildings: seedBuildings(), floors: seedFloors(), points: seedPoints() })
function at(pointId: string) {
  const hit = locatePoint(model, pointId)
  if (hit === null || hit.marker.mount === null) throw new Error(`示例测点 ${pointId} 缺少墙面定位`)
  return hit.marker
}

describe('3D 剖视卡只读演示档案', () => {
  it('倾角测点读取现有型号、柱侧位置、轴向与日期，仍不虚构埋深', () => {
    const marker = at(P_TILT)
    const device = seedDevices().find((row) => row.pointId === P_TILT) ?? null
    const view = installationViewOf(marker.point, device, marker.mount!, marker.mountHeight)
    expect(view.title).toBe('柱侧剖视示意')
    expect(view.deviceCode).toBe('B03-F2-TILT01-DEV1')
    expect(view.model).toContain('BNO055')
    expect(view.archivePosition).toContain('中柱')
    expect(view.direction).toContain('X 轴')
    expect(view.installDate).toBe('2026-09-15')
    expect(view.note).toContain('实际固定工艺与埋深待核实')
    expect(view.note).toContain('3D 标记仍按 2D 坐标投影')
    expect(view.modelHeight).toContain('模型示意')
  })

  it('档案指出楼板的振动测点不被称作已证实的墙内安装', () => {
    const marker = at(P_VIB)
    const device = seedDevices().find((row) => row.pointId === P_VIB) ?? null
    const view = installationViewOf(marker.point, device, marker.mount!, marker.mountHeight)
    expect(view.title).toBe('楼板测点示意')
    expect(view.note).toContain('3D 标记由 2D 坐标就近投影')
    expect(view.note).toContain('待现场核实')
  })

  it('没有绑定设备时明确缺少型号和位置，不套用其它测点的档案', () => {
    const marker = at(P_TILT)
    const view = installationViewOf(marker.point, null, marker.mount!, marker.mountHeight)
    expect(view.deviceName).toBe('未绑定设备')
    expect(view.model).toBe('未登记')
    expect(view.archivePosition).toBe('未登记')
    expect(view.direction).toBe('未登记')
  })
})
