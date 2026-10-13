/**
 * 保养写入的两类判定测试（V1-D 收口）：
 * - 生成任务的**事务内复核**：读计划之后计划被停用 / 设备被删除，提交时必须拦下；
 * - 异常描述与转问题的**规则下沉**：有异常必填描述、无异常不得转问题、断链能被一致性检查报出。
 *
 * 公共夹具在 `harness.ts`，正常路径见 `flow.test.ts`。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { scanIntegrity } from '@/core/integrity'
import { DAY, DEV, AT, OK_INPUT, answers, draft, setup } from './harness'

/* ---------------- 生成任务的事务内复核（P1） ---------------- */

describe('生成任务的复核发生在事务内', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('计划在读计划之后被停用：事务内复核拦下，不生成任务', async () => {
    await setup()
    const plans = useMaintenancePlanStore()
    await plans.savePlan(draft())
    const plan = (await db.maintenancePlans.toArray())[0]
    const { commitMaintenanceGenerate } = await import('@/db/maintenance/writes')
    const { planMaintenanceTask } = await import('@/core/maintenance/plan')
    // 草稿按"当时还启用"的计划构造，提交前另一窗口把它停用了
    const task = planMaintenanceTask({
      plan,
      plannedAt: '2026-09-22T01:00:00.000Z',
      deviceCode: DEV.code,
      deviceName: DEV.name,
      floorId: 'flr_1',
      zoneId: '二层走廊',
      actor: { name: '王师傅', roleLabel: '学校安全管理人员' },
      at: AT,
    })
    await db.maintenancePlans.update(plan.id, { enabled: false })
    const out = await commitMaintenanceGenerate({
      drafts: [{ task, log: { id: 'log_x', at: AT, actor: '王师傅', actorRole: '学校安全管理人员', action: 'create', objectType: 'system', objectId: task.id, objectLabel: 'x', summary: 'y', reason: '' } }],
    })
    expect(out.created).toHaveLength(0)
    expect(out.rejected[0]).toContain('计划已停用')
    expect(await db.maintenanceTasks.count()).toBe(0)
  })

  it('设备档案已被删除：事务内复核拦下并给出原因', async () => {
    await setup()
    const plans = useMaintenancePlanStore()
    await plans.savePlan(draft())
    const plan = (await db.maintenancePlans.toArray())[0]
    await db.devices.delete(plan.deviceId)
    const { commitMaintenanceGenerate } = await import('@/db/maintenance/writes')
    const { planMaintenanceTask } = await import('@/core/maintenance/plan')
    const task = planMaintenanceTask({
      plan,
      plannedAt: '2026-09-22T01:00:00.000Z',
      deviceCode: 'X',
      deviceName: '已删除设备',
      floorId: 'flr_1',
      zoneId: '二层走廊',
      actor: { name: '王师傅', roleLabel: '学校安全管理人员' },
      at: AT,
    })
    const out = await commitMaintenanceGenerate({
      drafts: [{ task, log: { id: 'log_y', at: AT, actor: '王师傅', actorRole: '学校安全管理人员', action: 'create', objectType: 'system', objectId: task.id, objectLabel: 'x', summary: 'y', reason: '' } }],
    })
    expect(out.created).toHaveLength(0)
    expect(out.rejected[0]).toContain('设备档案已删除')
    expect(await db.maintenanceTasks.count()).toBe(0)
  })
})

/* ---------------- 异常描述与转问题的规则下沉（P0-2） ---------------- */

describe('保养异常描述与转问题的判定下沉到仓储', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  async function makeTask(): Promise<string> {
    await setup()
    const plans = useMaintenancePlanStore()
    await plans.savePlan(draft())
    const tasks = useMaintenanceTaskStore()
    await tasks.generateForDay(DAY)
    return (await db.maintenanceTasks.toArray())[0].id
  }

  it('有异常项但没写描述时拒绝提交，数据库不变', async () => {
    const id = await makeTask()
    const tasks = useMaintenanceTaskStore()
    const out = await tasks.execute(id, { ...OK_INPUT, answers: answers({ fixed: 'abnormal' }) })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('必须写明异常描述')
    expect((await db.maintenanceTasks.get(id))?.status).toBe('pending')
    expect(await db.issues.count()).toBe(0)
  })

  it('没有异常项却要转问题处理时拒绝提交', async () => {
    const id = await makeTask()
    const tasks = useMaintenanceTaskStore()
    const out = await tasks.execute(id, { ...OK_INPUT, anomaly: { createIssue: true, note: '想顺手建个问题' } })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('没有异常项')
    expect(await db.issues.count()).toBe(0)
  })

  it('不转问题时异常描述落在执行记录里，不会只剩一个数字', async () => {
    const id = await makeTask()
    const tasks = useMaintenanceTaskStore()
    const out = await tasks.execute(id, {
      ...OK_INPUT,
      answers: answers({ fixed: 'abnormal' }),
      anomaly: { createIssue: false, note: '固定螺栓轻微锈蚀，已现场除锈' },
    })
    expect(out.ok).toBe(true)
    const task = await db.maintenanceTasks.get(id)
    expect(task?.execution?.abnormalNote).toContain('轻微锈蚀')
    expect(task?.execution?.issueId).toBeNull()
    expect(task?.timeline.at(-1)?.detail).toContain('异常描述：固定螺栓轻微锈蚀')
    expect(await db.issues.count()).toBe(0)
  })

  it('同一次提交重试不会重复建问题，问题编号沿用原值', async () => {
    const id = await makeTask()
    const tasks = useMaintenanceTaskStore()
    await tasks.execute(id, {
      ...OK_INPUT,
      answers: answers({ fixed: 'abnormal' }),
      anomaly: { createIssue: true, note: '螺栓锈蚀，转问题处理' },
    })
    const first = (await db.issues.toArray())[0]
    const task = (await db.maintenanceTasks.get(id))!
    const { writeMaintenanceExecute } = await import('@/db/maintenance/writes')
    // 模拟"同一次提交重试"：问题行再写一遍（编号传空，应由写入层沿用已存编号）
    await writeMaintenanceExecute({ task, photos: [], logs: [], issue: { ...first, issueNo: '' } })
    const after = await db.issues.toArray()
    expect(after).toHaveLength(1)
    expect(after[0].issueNo).toBe(first.issueNo)
    expect(after[0].maintenanceTaskId).toBe(id)
  })

  it('断链会被一致性检查报出来：任务指向不存在的问题、问题指向不存在的任务', async () => {
    const id = await makeTask()
    const tasks = useMaintenanceTaskStore()
    await tasks.execute(id, {
      ...OK_INPUT,
      answers: answers({ fixed: 'abnormal' }),
      anomaly: { createIssue: true, note: '螺栓锈蚀，转问题处理' },
    })
    const issue = (await db.issues.toArray())[0]
    const base = {
      buildings: [], floors: [], points: [], devices: [], baselines: [], records: [], audits: [], rules: [],
      events: [], notifications: [], plans: [], tasks: [], workOrders: [], attachments: [],
    }
    const clean = scanIntegrity({ ...base, issues: [issue], maintenancePlans: [], maintenanceTasks: await db.maintenanceTasks.toArray() })
    expect(clean.filter((row) => row.kind.includes('保养转问题'))).toHaveLength(0)

    const task = (await db.maintenanceTasks.toArray())[0]
    const broken = scanIntegrity({
      ...base,
      issues: [{ ...issue, maintenanceTaskId: 'plan_gone@2026-01-01T00:00:00.000Z' }],
      maintenancePlans: [],
      maintenanceTasks: [task],
    })
    const kinds = broken.map((row) => row.kind)
    expect(kinds).toContain('保养转问题断链')
    expect(kinds).toContain('保养转问题关联不一致')
  })
})
