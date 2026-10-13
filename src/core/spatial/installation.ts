/** 3D 剖视卡的数据投影：档案字段是真实输入，剖面部件只是演示标注。 */
import type { Device, Point } from '@/types/domain'
import type { PointMount } from './project'

type DeviceFields = Pick<Device, 'code' | 'name' | 'model' | 'mountPosition' | 'direction' | 'installDate'>
type PointFields = Pick<Point, 'code' | 'type'>

export interface InstallationView {
  title: string
  pointCode: string
  surfaceLabel: string
  coreLabel: string
  roomLabel: string
  deviceCode: string
  deviceName: string
  model: string
  archivePosition: string
  direction: string
  installDate: string
  modelHeight: string
  note: string
  slab: boolean
}

const PARTS: Record<Point['type'], { surface: string; core: string }> = {
  crack: { surface: '跨缝测量面', core: '位移敏感部件' },
  tilt: { surface: '柱侧定位面', core: '双轴倾角模块' },
  vibration: { surface: '楼板定位面', core: '三轴振动模块' },
  temp_humidity: { surface: '通风采样面', core: '温湿度模块' },
  manual_check: { surface: '人工检查位置', core: '无传感器芯体' },
}

export function installationViewOf(
  point: PointFields,
  device: DeviceFields | null,
  mount: PointMount,
  mountHeight: number,
): InstallationView {
  const slab = point.type === 'vibration' || (device?.mountPosition.includes('楼板') ?? false)
  const parts = PARTS[point.type]
  return {
    title: slab ? '楼板测点示意' : point.type === 'tilt' ? '柱侧剖视示意' : '墙体剖视',
    pointCode: point.code,
    surfaceLabel: parts.surface,
    coreLabel: parts.core,
    roomLabel: slab ? '可检修侧' : '室内侧',
    deviceCode: device?.code || '未绑定',
    deviceName: device?.name || '未绑定设备',
    model: device?.model || '未登记',
    archivePosition: device?.mountPosition || '未登记',
    direction: device?.direction && device.direction !== '—' ? device.direction : '未登记',
    installDate: device?.installDate || '未登记',
    modelHeight: `${mountHeight.toFixed(2)} m（模型示意）`,
    note: slab
      ? '档案记为楼板位置；3D 标记由 2D 坐标就近投影，固定工艺与实际埋深待现场核实。'
      : point.type === 'tilt'
        ? `档案位置为走廊中柱，3D 标记仍按 2D 坐标投影到${mount.zoneLabel}墙面；柱侧剖面仅是教学示意，实际固定工艺与埋深待核实。`
        : `3D 标记投影到${mount.zoneLabel}墙面；剖面芯体为教学示意，固定工艺与实际埋深待现场核实。`,
    slab,
  }
}
