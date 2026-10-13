/**
 * 保养写入测试的公共夹具（从 flow.test.ts 抽出：单个测试文件超过 450 行的硬指标）。
 *
 * 两个测试文件共用同一套档案与提交内容：夹具各写一份的话，改一处漏一处，
 * 两个文件的"同一个场景"会慢慢变成两个场景。
 */
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useSessionStore } from '@/stores/session'
import type { MaintenancePlanDraft } from '@/stores/maintenance/plans'
import { maintenanceAnswersOf } from '@/core/maintenance/plan'
import type { ChecklistItem, ChecklistAnswer, PlanCycle } from '@/types/inspection'
import { makeBuilding, makeDevice, makeFloor, makePoint } from '../fixtures'

export const AT = '2026-09-22T09:00:00.000Z'
export const DAY = '2026-09-22'
export const CHECKLIST: ChecklistItem[] = [
  { key: 'surface', label: '外壳与接线是否完好', required: true, hint: '' },
  { key: 'fixed', label: '固定螺栓是否牢固', required: true, hint: '' },
]
export const CYCLE: PlanCycle = { unit: 'day', interval: 1, atTime: '09:00' }

const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })
export const DEV = makeDevice({ id: 'dev_1', pointId: 'pnt_1' })

export async function setup(role = 'safety'): Promise<void> {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  await db.buildings.put({ ...BLD })
  await db.floors.put({ ...FLR })
  await db.points.put({ ...PNT })
  await db.devices.put({ ...DEV })
  const session = useSessionStore()
  session.name = '王师傅'
  session.role = role
}

export function draft(overrides: Partial<MaintenancePlanDraft> = {}): MaintenancePlanDraft {
  return {
    id: null,
    name: '裂缝传感器日保养',
    deviceId: 'dev_1',
    cycle: { ...CYCLE },
    startDate: '2026-09-01',
    endDate: null,
    owner: '王师傅',
    checklist: CHECKLIST.map((item) => ({ ...item })),
    remark: '',
    ...overrides,
  }
}

export function photoDraft(id: string) {
  return {
    id,
    fileName: `${id}.jpg`,
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    thumb: new Blob(['t'], { type: 'image/jpeg' }),
    size: 1,
    width: 10,
    height: 10,
    capturedAt: AT,
  }
}

export function answers(overrides: Partial<Record<string, ChecklistAnswer['result']>> = {}): ChecklistAnswer[] {
  return maintenanceAnswersOf(CHECKLIST).map((row) => {
    const picked = overrides[row.key]
    return { ...row, result: picked === undefined ? 'normal' : picked }
  })
}

export const OK_INPUT = {
  answers: answers(),
  measures: '清洁外壳、紧固螺栓、复核读数',
  materials: '无水乙醇、M6 螺栓',
  nextDueDate: '2026-09-23',
  note: '',
  photoDrafts: [photoDraft('mid_1'), photoDraft('mid_2')],
  anomaly: { createIssue: false, note: '' },
}
