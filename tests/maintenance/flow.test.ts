/**
 * 保养计划与任务的写入路径测试（V1-D 工作线 B）。
 *
 * 锁定的四条纪律：
 * ① 编号在写入事务内分配（并发建计划不撞号）；
 * ② 同一计划同一执行时刻只生成一条任务（业务键主键，重复点击与并发都只留一条）；
 * ③ 计划改动不追溯改写历史任务的快照；
 * ④ 任务、照片、时间线、审计日志同一事务 —— 失败整体回滚，界面提示"未写入数据，可重试"；
 *    保养发现异常只转问题，**不写入任何预警事件**（不得升级为建筑结构预警）。
 *
 * 异常描述判定与生成事务复核见 `gateChecks.test.ts`；公共夹具在 `harness.ts`。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useSessionStore } from '@/stores/session'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { scanIntegrity } from '@/core/integrity'
import { maintenanceAnswersOf } from '@/core/maintenance/plan'
import { todayInput } from '@/core/time'
import type { InspectionIssue } from '@/types/inspection'
import { CHECKLIST, DAY, DEV, OK_INPUT, answers, draft, photoDraft, setup } from './harness'

/* ---------------- 计划写入 ---------------- */

describe('保养计划写入', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('非安全管理人员不能建计划，且数据库不变', async () => {
    await setup('property')
    const plans = useMaintenancePlanStore()
    const result = await plans.savePlan(draft())
    expect(result.ok).toBe(false)
    expect(result.error).toContain('学校安全管理人员')
    expect(await db.maintenancePlans.count()).toBe(0)
    expect(await db.audits.count()).toBe(0)
  })

  it('新建计划在事务内分配编号，并发建两条不撞号', async () => {
    await setup()
    const plans = useMaintenancePlanStore()
    const [first, second] = await Promise.all([plans.savePlan(draft()), plans.savePlan(draft({ name: '应变计周保养' }))])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    const codes = (await db.maintenancePlans.toArray()).map((row) => row.code).sort()
    // 编号按**当天**日期分配，所以期望值也从当天推导：写死某一天会让这条测试过一天就红。
    const stamp = todayInput().replace(/-/g, '')
    expect(codes).toEqual([`MP-${stamp}-001`, `MP-${stamp}-002`])
    expect(await db.audits.count()).toBe(2)
  })

  it('缺少检查项或日期非法时拒绝写入，并给出原因', async () => {
    await setup()
    const plans = useMaintenancePlanStore()
    const empty = await plans.savePlan(draft({ checklist: [] }))
    expect(empty.ok).toBe(false)
    expect(empty.error).toContain('保养检查项')
    const badDate = await plans.savePlan(draft({ startDate: '2026-02-30' }))
    expect(badDate.ok).toBe(false)
    expect(badDate.error).toContain('开始日期')
    expect(await db.maintenancePlans.count()).toBe(0)
  })

  it('编辑保留原编号，启停各写一条日志且重复启停被拒', async () => {
    await setup()
    const plans = useMaintenancePlanStore()
    const created = await plans.savePlan(draft())
    const id = (await db.maintenancePlans.toArray())[0].id
    const edited = await plans.savePlan(draft({ id, name: '裂缝传感器日保养（修订）' }))
    expect(edited.ok).toBe(true)
    expect(edited.label).toBe(created.label)

    const off = await plans.setEnabled(id, false)
    expect(off.ok).toBe(true)
    expect(plans.byId(id)?.enabled).toBe(false)
    const again = await plans.setEnabled(id, false)
    expect(again.ok).toBe(false)
    expect(again.error).toContain('已经是停用状态')
    expect(await db.audits.count()).toBe(3)
  })
})

/* ---------------- 任务生成 ---------------- */

describe('保养任务生成（幂等与快照）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  async function seedPlan(): Promise<string> {
    await setup()
    const plans = useMaintenancePlanStore()
    await plans.savePlan(draft())
    return (await db.maintenancePlans.toArray())[0].id
  }

  it('重复点击与并发调用都只生成一条任务', async () => {
    await seedPlan()
    const tasks = useMaintenanceTaskStore()
    const first = await tasks.generateForDay(DAY)
    expect(first.ok).toBe(true)
    expect(first.created).toBe(1)
    const again = await tasks.generateForDay(DAY)
    expect(again.created).toBe(0)
    expect(again.skipped).toBe(1)

    await Promise.all([tasks.generateForDay(DAY), tasks.generateForDay(DAY)])
    const rows = await db.maintenanceTasks.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].taskNo).toBe('MT-20260922-001')
    expect(rows[0].status).toBe('pending')
  })

  it('停用计划后不再生成任务', async () => {
    const id = await seedPlan()
    const plans = useMaintenancePlanStore()
    await plans.setEnabled(id, false)
    const tasks = useMaintenanceTaskStore()
    const result = await tasks.generateForDay(DAY)
    expect(result.ok).toBe(true)
    expect(result.created).toBe(0)
    expect(await db.maintenanceTasks.count()).toBe(0)
  })

  it('改计划不追溯改写历史任务快照', async () => {
    const id = await seedPlan()
    const tasks = useMaintenanceTaskStore()
    await tasks.generateForDay(DAY)
    const before = JSON.stringify((await db.maintenanceTasks.toArray())[0].snapshot)

    const plans = useMaintenancePlanStore()
    await plans.savePlan(
      draft({ id, name: '改名后的计划', owner: '李工', cycle: { unit: 'week', interval: 1, atTime: '08:00' } }),
    )
    const after = (await db.maintenanceTasks.toArray())[0]
    expect(JSON.stringify(after.snapshot)).toBe(before)
    expect(after.snapshot.owner).toBe('王师傅')
    expect(after.snapshot.planName).toBe('裂缝传感器日保养')
    // 快照带位置：设备日后调拨，历史任务仍能说明当时在哪栋楼哪一层做的
    expect(after.snapshot.buildingId).toBe('bld_1')
    expect(after.snapshot.floorId).toBe('flr_1')
  })
})

/* ---------------- 执行闭环 ---------------- */

describe('保养执行（单事务与异常处置）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  async function makeTask(owner = '王师傅'): Promise<string> {
    await setup()
    const plans = useMaintenancePlanStore()
    await plans.savePlan(draft({ owner }))
    const tasks = useMaintenanceTaskStore()
    await tasks.generateForDay(DAY)
    return (await db.maintenanceTasks.toArray())[0].id
  }

  it('必答项未答、措施为空、下次日期非法时拒绝提交', async () => {
    const id = await makeTask()
    const tasks = useMaintenanceTaskStore()
    const unanswered = await tasks.execute(id, {
      ...OK_INPUT,
      answers: maintenanceAnswersOf(CHECKLIST),
    })
    expect(unanswered.ok).toBe(false)
    expect(unanswered.error).toContain('必答检查项')

    const noMeasure = await tasks.execute(id, { ...OK_INPUT, measures: '   ' })
    expect(noMeasure.ok).toBe(false)
    expect(noMeasure.error).toContain('维护措施')

    const badDate = await tasks.execute(id, { ...OK_INPUT, nextDueDate: '2026-02-30' })
    expect(badDate.ok).toBe(false)
    expect(badDate.error).toContain('下次保养日期')

    expect((await db.maintenanceTasks.toArray())[0].status).toBe('pending')
    expect(await db.attachments.count()).toBe(0)
  })

  it('非负责人不能执行；物业代执行必须写明代执行原因', async () => {
    const id = await makeTask('李工')
    const session = useSessionStore()

    session.name = '王师傅'
    session.role = 'safety'
    const tasks = useMaintenanceTaskStore()
    const denied = await tasks.execute(id, OK_INPUT)
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('李工')

    session.name = '物业值班甲'
    session.role = 'property'
    const noReason = await tasks.execute(id, OK_INPUT)
    expect(noReason.ok).toBe(false)
    expect(noReason.error).toContain('代执行原因')

    const substituted = await tasks.execute(id, { ...OK_INPUT, note: '李工外出，现场漏水需当日处理' })
    expect(substituted.ok).toBe(true)
    const row = (await db.maintenanceTasks.toArray())[0]
    expect(row.execution?.note).toContain('现场漏水')
    expect(row.execution?.by).toBe('物业值班甲')
  })

  it('完成后任务、照片、时间线、日志一起落库，重复执行被拒', async () => {
    const id = await makeTask()
    const tasks = useMaintenanceTaskStore()
    const logsBefore = await db.audits.count()
    const result = await tasks.execute(id, OK_INPUT)
    expect(result.ok).toBe(true)
    expect(result.label).toBe('MT-20260922-001')

    const row = await db.maintenanceTasks.get(id)
    expect(row?.status).toBe('done')
    expect(row?.execution?.measures).toContain('紧固螺栓')
    expect(row?.execution?.materials).toContain('无水乙醇')
    expect(row?.execution?.nextDueDate).toBe('2026-09-23')
    expect(row?.timeline.at(-1)?.action).toBe('完成保养')
    expect(row?.timeline.at(-1)?.detail).toContain('下次保养 2026-09-23')

    const attachments = await db.attachments.toArray()
    expect(attachments).toHaveLength(2)
    // 照片归属写在保养任务上：一致性检查按这个字段认领附件
    expect(attachments.every((item) => item.maintenanceTaskId === id)).toBe(true)
    expect(row?.execution?.photos).toEqual(attachments.map((item) => item.id).sort().reverse().reverse())
    expect(await db.audits.count()).toBe(logsBefore + 1)

    const twice = await tasks.execute(id, OK_INPUT)
    expect(twice.ok).toBe(false)
    expect(twice.error).toContain('已经完成过')
    expect(await db.attachments.count()).toBe(2)
  })

  it('事务失败时整体回滚：任务仍待保养，照片与日志都不留', async () => {
    const id = await makeTask()
    const tasks = useMaintenanceTaskStore()
    const logsBefore = await db.audits.count()
    const original = db.audits.bulkPut.bind(db.audits)
    ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟日志写入失败')
    }
    let result
    try {
      result = await tasks.execute(id, OK_INPUT)
    } finally {
      ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = original
    }
    expect(result.ok).toBe(false)
    expect(result.error).toContain('未写入数据')
    expect(result.error).toContain('可重试')
    expect((await db.maintenanceTasks.get(id))?.status).toBe('pending')
    expect(await db.attachments.count()).toBe(0)
    expect(await db.audits.count()).toBe(logsBefore)

    // 恢复后重试成功，且照片不重复
    const retry = await tasks.execute(id, OK_INPUT)
    expect(retry.ok).toBe(true)
    expect(await db.attachments.count()).toBe(2)
  })

  it('异常项只转问题，不写入任何预警事件', async () => {
    const id = await makeTask()
    const eventsBefore = await db.events.count()
    const tasks = useMaintenanceTaskStore()
    const result = await tasks.execute(id, {
      ...OK_INPUT,
      answers: answers({ fixed: 'abnormal' }),
      anomaly: { createIssue: true, note: '固定螺栓锈蚀，已除锈并更换' },
    })
    expect(result.ok).toBe(true)
    const issues = await db.issues.toArray()
    expect(issues).toHaveLength(1)
    expect(issues[0].source).toBe('maintenance')
    expect(issues[0].status).toBe('pending_review')
    expect(issues[0].description).toContain('螺栓锈蚀')
    expect(issues[0].issueNo).toMatch(/^ISS-\d{8}-001$/)
    expect(issues[0].eventId).toBeNull()
    // 保养异常不升级为结构预警：事件条数不变
    expect(await db.events.count()).toBe(eventsBefore)
    expect((await db.maintenanceTasks.get(id))?.timeline.at(-1)?.detail).toContain('异常项 1 条')
    // 双向关联：任务 → 问题、问题 → 任务
    const task = await db.maintenanceTasks.get(id)
    expect(task?.execution?.issueId).toBe(issues[0].id)
    expect(issues[0].maintenanceTaskId).toBe(id)
    expect(task?.execution?.abnormalNote).toContain('螺栓锈蚀')
  })
})
