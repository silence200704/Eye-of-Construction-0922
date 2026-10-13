/**
 * 模拟 NFC 导览（D 组）：定位真实任务与点位、给出"错码 → 正确码"的顺序，
 * 缺数据时只描述"将写入什么"并走既有受确认场景入口 —— **导览自身不写库、不替人签到**。
 */
import { describe, expect, it } from 'vitest'
import { executeConfirmedCommand, scenarioOfCommand } from '@/assistant/commands/execute'
import { buildStagePlan } from '@/assistant/guide/stage'
import { nfcGuideOf, taskRefOf, type TaskRef } from '@/assistant/guide/nfc'
import { commandFor, pendingCommands } from '@/assistant/actions'
import { buildSnapshot } from '@/assistant/selectors'
import { db } from '@/db/database'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { useEventsStore } from '@/stores/events'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { makeEvent, makeIssue, makeWorkOrder } from '../../fixtures'
import { setupHarness } from '../harness'

const PENDING_TASK: TaskRef = {
  id: 'plan_1@2026-09-20T01:00:00.000Z',
  taskNo: 'TK-20260920-001',
  planCode: 'PLAN-20260920-001',
  planName: '演示场景：3 号教学楼二层日常巡检',
  buildingId: 'bld_1',
  plannedAt: '2026-09-20T01:00:00.000Z',
  dueAt: '2026-09-20T09:00:00.000Z',
  status: 'pending',
  executorRole: 'inspector',
  points: [
    { pointId: 'pnt_1', status: 'arrived', attempts: 2 },
    { pointId: 'pnt_2', status: 'pending', attempts: 0 },
  ],
}

const INPUT = { tasks: [PENDING_TASK], points: [{ id: 'pnt_1', code: 'B03-F2-CRACK01', name: '二层走廊西墙裂缝测点' }, { id: 'pnt_2', code: 'B03-F2-TILT01', name: '二层走廊中柱倾角测点' }] }

describe('模拟 NFC 导览', () => {
  it('有任务时给出任务号、目标点位与"先错码后正确码"的顺序', () => {
    const guide = nfcGuideOf(INPUT, null)
    expect(guide.ready).toBe(true)
    expect(guide.taskNo).toBe('TK-20260920-001')
    // 优先讲未到点的那个点位
    expect(guide.pointCode).toBe('B03-F2-TILT01')
    expect(guide.steps.join()).toContain('错号')
    expect(guide.steps.join()).toContain('NFC-B03-F2-TILT01')
    expect(guide.arrivedPointCodes).toEqual(['B03-F2-CRACK01'])
    expect(guide.note).toContain('模拟读卡')
    expect(guide.note).toContain('不构成真实到场证明')
    // 身份要用给人看的中文角色名，不能把 executorRole 的枚举键（inspector）直接塞进话术
    expect(guide.note).toContain('当前身份需为「巡检人员」')
    expect(guide.confirmRequired).toBe(false)
  })

  it('事件测点就在任务里时优先讲它（与当前事件对得上）', () => {
    const guide = nfcGuideOf({ ...INPUT, tasks: [{ ...PENDING_TASK, points: [{ pointId: 'pnt_3', status: 'pending', attempts: 0 }, { pointId: 'pnt_1', status: 'pending', attempts: 0 }] }] }, { pointId: 'pnt_1' })
    expect(guide.pointCode).toBe('B03-F2-CRACK01')
  })

  it('没有任务时不造任务：要求先确认，并写清场景会写入什么', () => {
    const guide = nfcGuideOf({ tasks: [], points: [] }, null)
    expect(guide.ready).toBe(false)
    expect(guide.confirmRequired).toBe(true)
    expect(guide.prepareNote).toContain('巡检计划')
    expect(guide.prepareNote).toContain('导览不写数据')
    expect(guide.steps[0]).toContain('系统设置一键载入全链演示数据')
  })

  it('指令清单里两条都在，且默认不可点、按需才启用', () => {
    const all = pendingCommands()
    expect(all.map((row) => row.id)).toEqual(['prepare_red_demo', 'prepare_inspection_demo'])
    expect(all.every((row) => !row.enabled)).toBe(true)
    expect(pendingCommands(['prepare_inspection_demo']).filter((row) => row.enabled).map((row) => row.id))
      .toEqual(['prepare_inspection_demo'])
  })

  it('按 id 取指令拿到的是这条指令本身，而不是清单第一条', () => {
    // 导览卡的巡检按钮原先用 pendingCommands([id])[0] 取，拿到的是清单第一条（红色预警，enabled=false），
    // 界面按 enabled=false 静默丢弃 —— 按钮点不动，测试却因为只断言下标而全绿。
    expect(commandFor('prepare_inspection_demo')?.id).toBe('prepare_inspection_demo')
    expect(commandFor('prepare_inspection_demo')?.enabled).toBe(true)
    expect(commandFor('prepare_red_demo')?.id).toBe('prepare_red_demo')
    expect(commandFor('prepare_red_demo')?.enabled).toBe(true)
    expect(commandFor('drop_database')).toBeUndefined()
  })

  it('只认登记过的指令：未知 id 直接拒绝，取消不写库', async () => {
    await setupHarness()
    await expect(executeConfirmedCommand('drop_database', true)).rejects.toThrow('未登记的演示指令')
    expect(scenarioOfCommand('prepare_inspection_demo')).toBe('inspection')
    const before = [await db.plans.count(), await db.tasks.count(), await db.audits.count()]
    expect(await executeConfirmedCommand('prepare_inspection_demo', false)).toBeNull()
    expect([await db.plans.count(), await db.tasks.count(), await db.audits.count()]).toEqual(before)
  })

  it('确认后走现有巡检场景：写入计划与任务，导览随之变为"已就绪"', async () => {
    localStorage.clear()
    await setupHarness()
    // 巡检场景要在示例校区上跑：先按 guide.test.ts 的口径载入示例数据
    await useArchiveStore().loadSeed()
    await Promise.all([useRecordsStore().reload(), useEventsStore().reload()])
    expect(await db.plans.count()).toBe(0)

    const out = await executeConfirmedCommand('prepare_inspection_demo', true)
    expect(out?.ok, out?.message ?? '场景未返回结果').toBe(true)
    await Promise.all([usePlanStore().reload(), useTaskStore().reload()])

    expect(await db.plans.count()).toBeGreaterThan(0)
    const plan = buildStagePlan(buildSnapshot(), '')
    expect(plan.nfc.ready).toBe(true)
    expect(plan.nfc.taskNo).not.toBe('')
    expect(plan.nfc.taskNo).toContain('TK-')
    expect(plan.nfc.confirmRequired).toBe(false)

    // 重复准备按业务键幂等：任务不翻倍
    const tasksAfterFirst = await db.tasks.count()
    await executeConfirmedCommand('prepare_inspection_demo', true)
    expect(await db.tasks.count()).toBe(tasksAfterFirst)
  })

  it('任务投影只取定位需要的字段（不带检查清单答案）', () => {
    const ref = taskRefOf(
      {
        id: 'tk_1', taskNo: 'TK-20260920-001', planId: 'plan_1', buildingId: 'bld_1',
        planSnapshot: { planCode: 'PLAN-1', planName: '巡检', executorRole: 'inspector', buildingId: 'bld_1', floorIds: [], pointIds: [], checklist: [] },
        plannedAt: '2026-09-20T01:00:00.000Z', dueAt: '2026-09-20T09:00:00.000Z', status: 'pending',
        results: [{ pointId: 'pnt_1', status: 'arrived', attempts: [{}, {}] } as never],
        issueIds: [], createdAt: '2026-09-20T01:00:00.000Z', createdBy: '测试',
        updatedAt: '2026-09-20T01:00:00.000Z', updatedBy: '测试',
      },
      '巡检', 'PLAN-1',
    )
    expect(ref.points).toEqual([{ pointId: 'pnt_1', status: 'arrived', attempts: 2 }])
    expect(Object.keys(ref)).toEqual(['id', 'taskNo', 'planCode', 'planName', 'buildingId', 'plannedAt', 'dueAt', 'status', 'executorRole', 'points'])
  })

  it('NFC 指引不写库：只看不改', async () => {
    await setupHarness({ events: [makeEvent({ id: 'evt_1', pointId: 'pnt_1' })], issues: [makeIssue({ id: 'iss_1', eventId: 'evt_1' })], workOrders: [makeWorkOrder({ id: 'wo_1', issueId: 'iss_1', eventId: 'evt_1', status: 'repairing' })] })
    const before = [await db.plans.count(), await db.tasks.count(), await db.audits.count()]
    buildStagePlan(buildSnapshot(), 'evt_1')
    expect([await db.plans.count(), await db.tasks.count(), await db.audits.count()]).toEqual(before)
    void useDemoScenarioStore()
  })
})
