/** 附加演示测点：共享档案坐标供 2D/3D 使用；不替换原有测点，不扩展照片素材绑定。 */
import { db } from '@/db/database'
import { baseline, device, point, P_CRACK, P_TH, P_TILT, P_VIB } from '@/db/seedFactories'
import { buildAuditLog } from '@/db/repo'
import { toPlain } from '@/core/plain'
import { useArchiveStore } from '@/stores/archive'
import type { PointType } from '@/types/domain'

export const READY_CRACK = 'pnt_demo_b03_f3_crack01'
export const CLOSED_CRACK = 'pnt_demo_b03_f3_crack02'
export const QUALITY_TILT = 'pnt_demo_b02_f2_tilt01'
export const STALE_VIB = 'pnt_demo_b04_f1_vib01'
export const NORMAL_TH = 'pnt_demo_b01_f2_th01'
export const COVERAGE_NOTE = '演示场景[数据全面化]'

interface ExtraPoint {
  id: string; code: string; name: string; buildingId: string; floorId: string
  type: PointType; template: string; x: number; y: number
}

export const EXTRA_POINTS: ExtraPoint[] = [
  { id: READY_CRACK, code: 'B03-F3-CRACK01', name: '三层走廊东墙裂缝（待处理案例）', buildingId: 'bld_b03', floorId: 'flr_b03_03', type: 'crack', template: P_CRACK, x: 0.75, y: 0.44 },
  { id: CLOSED_CRACK, code: 'B03-F3-CRACK02', name: '三层走廊西墙裂缝（历史闭环案例）', buildingId: 'bld_b03', floorId: 'flr_b03_03', type: 'crack', template: P_CRACK, x: 0.22, y: 0.44 },
  { id: QUALITY_TILT, code: 'B02-F2-TILT01', name: '二层走廊倾角（质量对照案例）', buildingId: 'bld_b02', floorId: 'flr_b02_02', type: 'tilt', template: P_TILT, x: 0.46, y: 0.44 },
  { id: STALE_VIB, code: 'B04-F1-VIB01', name: '主馆振动（过期数据案例）', buildingId: 'bld_b04', floorId: 'flr_b04_01', type: 'vibration', template: P_VIB, x: 0.65, y: 0.5 },
  { id: NORMAL_TH, code: 'B01-F2-TH01', name: '二层温湿度（正常案例）', buildingId: 'bld_b01', floorId: 'flr_b01_02', type: 'temp_humidity', template: P_TH, x: 0.7, y: 0.5 },
]

export const extraDeviceId = (id: string): string => id.replace('pnt_', 'dev_')

/** 同编号/主键冲突先拒绝；已登记行保持原样，包括用户改过的坐标、归档和规则版本。 */
export async function prepareExtraArchive(): Promise<number> {
  const archive = useArchiveStore()
  let created = 0
  await db.transaction('rw', [db.points, db.devices, db.baselines, db.rules, db.audits, db.floors, db.buildings], async () => {
    for (const spec of EXTRA_POINTS) {
      const existing = await db.points.get(spec.id)
      if (existing !== undefined) {
        if (!existing.remark.startsWith(COVERAGE_NOTE)) throw new Error(`${spec.code} 主键与既有档案冲突`)
        if (existing.status !== 'active') throw new Error(`${spec.code} 已归档，不恢复或改写`)
        continue
      }
      if (await db.points.where('code').equals(spec.code).first()) throw new Error(`${spec.code} 编号已被占用`)
      const floor = await db.floors.get(spec.floorId)
      const building = await db.buildings.get(spec.buildingId)
      if (floor?.status !== 'active' || floor.buildingId !== spec.buildingId || building?.status !== 'active') throw new Error(`${spec.code} 楼层或楼栋未在册`)
      await addExtraArchive(spec)
      created += 1
    }
  })
  await archive.reload()
  return created
}

async function addExtraArchive(spec: ExtraPoint): Promise<void> {
  const archive = useArchiveStore()
  const template = archive.pointById(spec.template)
  const rule = archive.rules.find((row) => row.pointIds.includes(spec.template))
  const templateDevice = archive.devices.find((row) => row.pointId === spec.template)
  if (template === undefined || rule === undefined || templateDevice === undefined) throw new Error(`${spec.code} 缺少原演示规则或设备模板`)
  const at = new Date().toISOString()
  const zoneId = (await db.floors.get(spec.floorId))?.zones[0] ?? '走廊'
  const row = point({ id: spec.id, code: spec.code, name: spec.name, buildingId: spec.buildingId, floorId: spec.floorId, type: spec.type, zoneId, coord: { x: spec.x, y: spec.y }, owner: template.owner, backupPerson: template.backupPerson, installDate: '2026-09-15', dataSource: 'demo', remark: `${COVERAGE_NOTE} 临时测试档案；位置示意，不含新增墙体照片对` })
  const dev = device({ ...templateDevice, id: extraDeviceId(spec.id), code: `DEV-${spec.code}`, name: `${spec.name}传感器`, pointId: spec.id, serial: `DEMO-${spec.code}`, nodeId: `DEMO-${spec.code}`, mountPosition: `${zoneId}墙面定位示意（临时测试档案，实际安装方式与埋深未登记）` })
  const ruleId = `rule_demo_${spec.id}`
  await db.points.add(toPlain(row))
  await db.devices.add(toPlain({ ...dev, gateway: `演示网关-${spec.buildingId}`, health: 'unknown' }))
  await db.rules.add(toPlain({ ...rule, id: `${ruleId}@V1.0`, ruleId, code: `DEMO-${spec.code}`, name: `${spec.code} 演示规则`, pointIds: [spec.id], buildingIds: [spec.buildingId], note: `${COVERAGE_NOTE} 沿用原指标阈值，独立限定测点`, createdAt: at, updatedAt: at }))
  const base = archive.baselines.find((item) => item.pointId === spec.template)
  if (base !== undefined) await db.baselines.add(toPlain(baseline({ ...base, id: `baseline_demo_${spec.id}`, pointId: spec.id, reason: `${COVERAGE_NOTE} 预设基准` })))
  await db.audits.add(buildAuditLog({ actor: '演示数据准备', actorRole: 'system', action: 'create', objectType: 'point', objectId: row.id, objectLabel: row.code, summary: '新增跨楼栋演示测点、设备与独立规则', reason: row.remark }))
}
