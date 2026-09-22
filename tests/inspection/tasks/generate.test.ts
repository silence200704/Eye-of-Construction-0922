/**
 * 任务生成的并发幂等与计划快照测试。
 *
 * 这里跑的是**真实数据库行为**（fake-indexeddb 提供内存版 IndexedDB）：
 * 任务主键 = 计划 ID + 执行时刻，写入用 add()，撞键由 IndexedDB 抛 ConstraintError，
 * 因此"快速双击 / 两个入口同时调用"也只会落一条任务 —— 内存里去重挡不住并发。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import type { InspectionPlan } from '@/types/inspection'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }

const BLD = makeBuilding({ id: 'bld_1' })
const FLR_1 = makeFloor({ id: 'flr_1', buildingId: 'bld_1', name: '二层', zones: ['二层走廊'] })
const FLR_2 = makeFloor({ id: 'flr_2', buildingId: 'bld_1', name: '三层', zones: ['三层走廊'] })
const PNT_1 = makePoint({ id: 'pnt_1', code: 'B01-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })
const PNT_2 = makePoint({ id: 'pnt_2', code: 'B01-F3-TILT01', buildingId: 'bld_1', floorId: 'flr_2', zoneId: '三层走廊' })

function plan(override: Partial<InspectionPlan> = {}): InspectionPlan {
  return {
    ...AUDIT,
    id: 'plan_1',
    code: 'PLAN-20260920-001',
    name: '二层走廊日巡检',
    kind: 'patrol',
    buildingId: 'bld_1',
    floorIds: ['flr_1'],
    pointIds: ['pnt_1'],
    cycle: { unit: 'day', interval: 1, atTime: '09:00' },
    startDate: '2026-09-01',
    endDate: null,
    owner: '李老师',
    executorRole: 'inspector',
    checklist: [{ key: 'surface', label: '外观是否完好', required: true, hint: '' }],
    enabled: true,
    remark: '',
    ...override,
  }
}

/** 造一个可用的库：楼栋/楼层/测点进档，计划进库（任务生成依赖 store 里的计划） */
async function seedPlan(row: InspectionPlan): Promise<void> {
  await db.buildings.put({ ...BLD })
  await db.floors.bulkPut([{ ...FLR_1 }, { ...FLR_2 }])
  await db.points.bulkPut([{ ...PNT_1 }, { ...PNT_2 }])
  await db.plans.put({ ...row })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  const archive = (await import('@/stores/archive')).useArchiveStore()
  const session = (await import('@/stores/session')).useSessionStore()
  archive.buildings = [BLD]
  archive.floors = [FLR_1, FLR_2]
  archive.points = [PNT_1, PNT_2]
  session.name = '演示操作员'
  session.role = 'safety'
})

describe('任务生成并发幂等', () => {
  it('并发调用两次，只产生一条任务', async () => {
    await seedPlan(plan())
    const plans = usePlanStore()
    const tasks = useTaskStore()
    await plans.reload()
    await tasks.reload()

    const [first, second] = await Promise.all([tasks.generateFor(new Date('2026-09-20T00:00:00')), tasks.generateFor(new Date('2026-09-20T00:00:00'))])
    const rows = await db.tasks.toArray()

    expect(rows).toHaveLength(1)
    expect(first.created.length + second.created.length).toBe(1)
    expect(first.skipped + second.skipped).toBe(1)
    expect(rows[0].id).toBe(`plan_1@${new Date('2026-09-20T09:00:00').toISOString()}`)
  })

  it('日志能证明幂等：并发只产生一条任务、一条带唯一键的创建日志', async () => {
    await seedPlan(plan())
    const plans = usePlanStore()
    const tasks = useTaskStore()
    await plans.reload()
    await tasks.reload()

    const day = new Date('2026-09-20T00:00:00')
    await Promise.all([tasks.generateFor(day), tasks.generateFor(day)])
    await tasks.generateFor(day)

    const logs = await db.audits.toArray()
    const createLogs = logs.filter((row) => row.action === 'create' && row.summary.includes('生成任务'))
    expect(createLogs).toHaveLength(1)
    const key = `plan_1@${new Date('2026-09-20T09:00:00').toISOString()}`
    expect(createLogs[0].objectId).toBe(key)
    expect(createLogs[0].summary).toContain('PLAN-20260920-001')
    expect(createLogs[0].summary).toContain('TK-20260920-001')
    expect(createLogs[0].reason).toContain(`唯一键：${key}`)
  })

  it('顺序重复调用同样只保留一条，并如实报告跳过', async () => {
    await seedPlan(plan())
    const plans = usePlanStore()
    const tasks = useTaskStore()
    await plans.reload()
    await tasks.reload()

    const day = new Date('2026-09-20T00:00:00')
    const first = await tasks.generateFor(day)
    const second = await tasks.generateFor(day)
    expect(first.created).toHaveLength(1)
    expect(second.created).toHaveLength(0)
    expect(second.skipped).toBe(1)
    expect(await db.tasks.count()).toBe(1)
  })

  it('任务编号在并发下不重复', async () => {
    await seedPlan(plan())
    await seedPlan(plan({ id: 'plan_2', code: 'PLAN-20260920-002', pointIds: ['pnt_2'], floorIds: ['flr_2'] }))
    const plans = usePlanStore()
    const tasks = useTaskStore()
    await plans.reload()
    await tasks.reload()
    await Promise.all([
      tasks.generateFor(new Date('2026-09-20T00:00:00')),
      tasks.generateFor(new Date('2026-09-20T00:00:00')),
    ])
    const rows = await db.tasks.toArray()
    expect(new Set(rows.map((row) => row.taskNo)).size).toBe(rows.length)
  })
})

describe('任务保存计划快照', () => {
  it('跨两个楼层的计划，任务里两层范围完整保留', async () => {
    await seedPlan(plan({ floorIds: ['flr_1', 'flr_2'], pointIds: ['pnt_1', 'pnt_2'] }))
    const plans = usePlanStore()
    const tasks = useTaskStore()
    await plans.reload()
    await tasks.reload()
    await tasks.generateFor(new Date('2026-09-20T00:00:00'))

    const row = (await db.tasks.toArray())[0]
    expect(row.planSnapshot.floorIds).toEqual(['flr_1', 'flr_2'])
    expect(row.planSnapshot.pointIds).toEqual(['pnt_1', 'pnt_2'])
    expect(row.results.map((item) => item.pointId)).toEqual(['pnt_1', 'pnt_2'])
  })

  it('计划改了执行角色，旧任务仍归原角色', async () => {
    await seedPlan(plan({ executorRole: 'inspector' }))
    const plans = usePlanStore()
    const tasks = useTaskStore()
    await plans.reload()
    await tasks.reload()
    await tasks.generateFor(new Date('2026-09-20T00:00:00'))

    // 计划改派给物业
    await db.plans.put({ ...plan({ executorRole: 'property' }) })
    await plans.reload()
    await tasks.reload()

    expect(tasks.tasksForRole('inspector')).toHaveLength(1)
    expect(tasks.tasksForRole('property')).toHaveLength(0)
    expect(tasks.tasksForRole('inspector')[0].planSnapshot.executorRole).toBe('inspector')
  })

  it('计划改了必查点，旧任务保留原检查点，新任务才用新范围', async () => {
    await seedPlan(plan({ pointIds: ['pnt_1'] }))
    const plans = usePlanStore()
    const tasks = useTaskStore()
    await plans.reload()
    await tasks.reload()
    await tasks.generateFor(new Date('2026-09-20T00:00:00'))

    // 改成另一个必查点（第二天生效的那条）
    await db.plans.put({ ...plan({ pointIds: ['pnt_2'] }) })
    await plans.reload()
    await tasks.reload()
    // 同一天不再新建（键已存在），第二天按新范围生成
    await tasks.generateFor(new Date('2026-09-20T00:00:00'))
    await tasks.generateFor(new Date('2026-09-21T00:00:00'))

    const rows = await db.tasks.toArray()
    const first = rows.find((row) => row.plannedAt === new Date('2026-09-20T09:00:00').toISOString())
    const second = rows.find((row) => row.plannedAt === new Date('2026-09-21T09:00:00').toISOString())
    expect(first?.planSnapshot.pointIds).toEqual(['pnt_1'])
    expect(first?.results.map((item) => item.pointId)).toEqual(['pnt_1'])
    expect(second?.planSnapshot.pointIds).toEqual(['pnt_2'])
  })

  it('任务卡与我的任务读快照的清单模板，计划删掉也不受影响', async () => {
    await seedPlan(plan())
    const plans = usePlanStore()
    const tasks = useTaskStore()
    await plans.reload()
    await tasks.reload()
    await tasks.generateFor(new Date('2026-09-20T00:00:00'))

    await db.plans.clear()
    await plans.reload()
    await tasks.reload()

    const row = tasks.tasks[0]
    expect(row.planSnapshot.planName).toBe('二层走廊日巡检')
    expect(row.planSnapshot.checklist.map((item) => item.label)).toEqual(['外观是否完好'])
    expect(tasks.tasksForRole('inspector')).toHaveLength(1)
  })
})
