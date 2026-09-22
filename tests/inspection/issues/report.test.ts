/**
 * 巡检问题写入的受控入口与并发唯一性测试。
 *
 * 覆盖面：角色校验、单事务提交（问题 + 任务关联 + 日志）、事务失败不留半成品、
 * 并发同一提交只生成一条、并发不同异常各自建单、人工上报与预警转单的角色规则、
 * attachPhotos 的 null 语义。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useIssueStore } from '@/stores/inspection/issues'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import type { InspectionPlan } from '@/types/inspection'
import { makeBuilding, makeEvent, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })
const CHECKLIST = [{ key: 'surface', label: '外观是否完好', required: true, hint: '' }]

let taskKey = ''

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
    checklist: CHECKLIST,
    enabled: true,
    remark: '',
    ...override,
  }
}

async function setup(role = 'inspector'): Promise<ReturnType<typeof useTaskStore>> {
  setActivePinia(createPinia())
  await db.delete()
  await db.open()
  await db.buildings.put({ ...BLD })
  await db.floors.put({ ...FLR })
  await db.points.put({ ...PNT })
  const archive = useArchiveStore()
  archive.buildings = [BLD]
  archive.floors = [FLR]
  archive.points = [PNT]
  const session = useSessionStore()
  session.name = '张工'
  session.role = role

  const plans = usePlanStore()
  await plans.savePlan(null, {
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
    checklist: CHECKLIST,
    enabled: true,
    remark: '',
  })
  const tasks = useTaskStore()
  await tasks.reload()
  await tasks.generateFor(new Date('2026-09-20T00:00:00'))
  taskKey = tasks.tasks[0]?.id ?? ''
  expect(taskKey).not.toBe('')
  return tasks
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('巡检问题写入入口', () => {
  it('非执行角色不能创建巡检问题：问题表与日志都不新增', async () => {
    const tasks = await setup('safety')
    const issuesBefore = await db.issues.count()
    const logsBefore = await db.audits.count()

    const out = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '以安全管理人员身份替巡检人员建单',
      photos: [],
    })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('执行角色')
    expect(out.issue).toBeNull()
    expect(await db.issues.count()).toBe(issuesBefore)
    expect(await db.audits.count()).toBe(logsBefore)
  })

  it('执行角色上报问题成功后，问题已关联到本任务与点位', async () => {
    const tasks = await setup('inspector')
    const out = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '支架螺栓松动，轻碰有位移',
      photos: [],
    })
    expect(out.ok).toBe(true)
    expect(out.issue?.taskId).toBe(taskKey)
    expect(out.issue?.pointId).toBe('pnt_1')
    const result = tasks.byId(taskKey)?.results.find((row) => row.pointId === 'pnt_1')
    expect(result?.issueIds).toEqual([out.issue?.id])
    expect(result?.abnormalHandling.linkedIssueId).toBe(out.issue?.id)
  })

  it('问题、任务与日志在同一个事务里提交：要么都成立，要么都不落库', async () => {
    const tasks = await setup('inspector')
    const issues = useIssueStore()
    await issues.reload()
    const issuesBefore = await db.issues.count()
    const tasksBefore = JSON.stringify(await db.tasks.toArray())
    const logsBefore = await db.audits.count()

    const out = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '支架螺栓松动',
      photos: [],
    })
    expect(out.ok).toBe(true)

    // 三条写入同时存在：问题 1 条、任务结果已关联、日志 +2（建问题 + 关联任务）
    expect(await db.issues.count()).toBe(issuesBefore + 1)
    expect(await db.audits.count()).toBe(logsBefore + 2)
    const storedTask = await db.tasks.get(taskKey)
    expect(storedTask?.results[0].abnormalHandling.linkedIssueId).toBe(out.issue?.id)
    expect(storedTask?.results[0].issueIds).toEqual([out.issue?.id])
    expect(JSON.stringify(await db.tasks.toArray())).not.toBe(tasksBefore)

    // 同一提交重试：复用那条问题，不新建、日志也不再增加
    const again = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '支架螺栓松动',
      photos: [],
    })
    expect(again.ok).toBe(true)
    expect(again.duplicated).toBe(true)
    expect(again.issue?.id).toBe(out.issue?.id)
    expect(await db.issues.count()).toBe(issuesBefore + 1)
    expect(await db.audits.count()).toBe(logsBefore + 2)
  })

  it('事务失败时不留下半成品：问题、任务、日志都不变', async () => {
    const tasks = await setup('inspector')
    const issues = useIssueStore()
    await issues.reload()
    const issuesBefore = await db.issues.count()
    const logsBefore = await db.audits.count()
    const taskBefore = JSON.stringify(await db.tasks.get(taskKey))

    // 人为让事务内的写入失败（audits 表在事务中被关掉）
    const original = db.audits.bulkPut.bind(db.audits)
    ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟日志写入失败')
    }
    let failed = false
    try {
      await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
        anomalyType: '探头松动',
        description: '这次提交会失败',
        photos: [],
      })
    } catch {
      failed = true
    } finally {
      ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = original
    }

    expect(failed).toBe(true)
    expect(await db.issues.count()).toBe(issuesBefore)
    expect(await db.audits.count()).toBe(logsBefore)
    expect(JSON.stringify(await db.tasks.get(taskKey))).toBe(taskBefore)

    // 恢复后重试：只生成一条问题
    const retry = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '重试这一次应当成功',
      photos: [],
    })
    expect(retry.ok).toBe(true)
    expect(await db.issues.count()).toBe(issuesBefore + 1)
  })

  it('并发提交同一巡检问题：只生成 1 条问题、1 条任务关联、2 条日志', async () => {
    const tasks = await setup('inspector')
    const issues = useIssueStore()
    await issues.reload()
    const issuesBefore = await db.issues.count()
    const logsBefore = await db.audits.count()

    const payload = { anomalyType: '探头松动', description: '支架螺栓松动（并发）', photos: [] }
    const [a, b] = await Promise.all([
      tasks.reportInspectionIssue(taskKey, 'pnt_1', payload),
      tasks.reportInspectionIssue(taskKey, 'pnt_1', payload),
    ])

    // 两次调用算出的主键相同 → 第二次撞主键 → 复用；但两条都算"成功"
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(a.issue?.id).toBe(b.issue?.id)
    expect([a.duplicated, b.duplicated].filter((flag) => flag === true)).toHaveLength(1)

    expect(await db.issues.count()).toBe(issuesBefore + 1)
    // 日志：一条提交问题 + 一条任务关联（复用那次不再写日志）
    expect(await db.audits.count()).toBe(logsBefore + 2)
    const stored = await db.tasks.get(taskKey)
    expect(stored?.results[0].issueIds).toHaveLength(1)
    expect(stored?.results[0].abnormalHandling.linkedIssueId).toBe(a.issue?.id)
  })

  it('并发提交不同异常类型：两条问题、编号不同', async () => {
    const tasks = await setup('inspector')
    const issues = useIssueStore()
    await issues.reload()

    const [a, b] = await Promise.all([
      tasks.reportInspectionIssue(taskKey, 'pnt_1', { anomalyType: '探头松动', description: '支架松动', photos: [] }),
      tasks.reportInspectionIssue(taskKey, 'pnt_1', { anomalyType: '外观破损', description: '外壳裂痕', photos: [] }),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(a.issue?.id).not.toBe(b.issue?.id)
    expect(a.issue?.issueNo).not.toBe(b.issue?.issueNo)
    expect(await db.issues.count()).toBe(2)
  })

  it('人工上报不需要任务，任何现场身份都能报', async () => {
    await setup('property')
    const issues = useIssueStore()
    await issues.reload()
    const out = await issues.reportManualIssue({
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      floorId: 'flr_1',
      zoneId: '二层走廊',
      anomalyType: '渗水受潮',
      description: '墙角渗水',
      photos: [],
      detail: '路过时发现墙角渗水',
    })
    expect(out.ok).toBeUndefined()
    expect(out.issue.source).toBe('report')
    expect(out.issue.taskId).toBeNull()
    expect(await db.issues.count()).toBe(1)
  })

  it('预警转问题只有安全管理人员能做，且事件编号写入问题并按事件归并', async () => {
    await setup('inspector')
    const issues = useIssueStore()
    await issues.reload()
    await expect(
      issues.createIssueFromEvent({
        eventId: 'evt_1',
        pointId: 'pnt_1',
        buildingId: 'bld_1',
        floorId: 'flr_1',
        zoneId: '二层走廊',
        anomalyType: '越限',
        description: '预警转单',
        photos: [],
        detail: '由预警事件转单',
      }),
    ).rejects.toThrow('学校安全管理人员')

    const session = useSessionStore()
    session.role = 'safety'
    await db.events.put(makeEvent({ id: 'evt_1', eventNo: 'E20260920-001', pointId: 'pnt_1' }))
    const out = await issues.createIssueFromEvent({
      eventId: 'evt_1',
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      floorId: 'flr_1',
      zoneId: '二层走廊',
      anomalyType: '越限',
      description: '预警转单',
      photos: [],
      detail: '由预警事件转单',
    })
    expect(out.issue.source).toBe('sensor')
    expect(out.issue.eventId).toBe('evt_1')
    expect(out.issue.submissionKey).toBe('event:evt_1')
    const eventAfterCreate = await db.events.get('evt_1')
    expect(eventAfterCreate?.timeline).toHaveLength(1)
    expect(eventAfterCreate?.timeline[0]?.action).toBe('转问题处理')
    expect(eventAfterCreate?.timeline[0]?.detail).toContain(out.issue.issueNo)

    const repeated = await issues.createIssueFromEvent({
      eventId: 'evt_1',
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      floorId: 'flr_1',
      zoneId: '二层走廊',
      anomalyType: '越限',
      description: '再次点击同一预警的转问题处理',
      photos: [],
      detail: '由同一预警事件重复发起转问题处理',
    })
    expect(repeated.duplicated).toBe(true)
    expect(repeated.issue.id).toBe(out.issue.id)
    expect(await db.issues.count()).toBe(1)
    expect((await db.events.get('evt_1'))?.timeline).toHaveLength(1)
  })

  it('预警转问题拒绝不存在的事件，且不留下问题或日志', async () => {
    await setup('safety')
    const issues = useIssueStore()
    await issues.reload()
    const beforeIssues = await db.issues.count()
    const beforeLogs = await db.audits.count()

    await expect(
      issues.createIssueFromEvent({
        eventId: 'evt_missing',
        pointId: 'pnt_1',
        buildingId: 'bld_1',
        floorId: 'flr_1',
        zoneId: '二层走廊',
        anomalyType: '越限',
        description: '不存在事件不能转问题',
        photos: [],
        detail: '应先确认事件真实存在再创建问题',
      }),
    ).rejects.toThrow('预警事件不存在')
    expect(await db.issues.count()).toBe(beforeIssues)
    expect(await db.audits.count()).toBe(beforeLogs)
  })

  it('问题缓存里找不到时 attachPhotos 返回 null（页面据此判失败、留草稿）', async () => {
    await setup('inspector')
    const issues = useIssueStore()
    await issues.reload()
    expect(await issues.attachPhotos('iss_not_exist', ['att_1'])).toBeNull()
  })
})
