/**
 * 第三步收口测试：并发唯一性、主键不误合并、缓存过期、审计写入失败回滚。
 *
 * 验收口径（评审给定）：
 * ① 同一次并发提交只生成一条问题；
 * ② 不同提交绝不被误合并（主键命中时必须核对完整提交标识）；
 * ③ 任一审计写入失败后：任务状态、到点尝试、问题关联均不改变。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { issueIdOf } from '@/db/inspection/issueWrites'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useIssueStore } from '@/stores/inspection/issues'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import type { InspectionPlan } from '@/types/inspection'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })

let taskKey = ''

function plan(): InspectionPlan {
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
  }
}

async function setup(): Promise<ReturnType<typeof useTaskStore>> {
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
  session.role = 'inspector'
  const plans = usePlanStore()
  const draft = plan()
  await plans.savePlan(null, {
    name: draft.name,
    kind: draft.kind,
    buildingId: draft.buildingId,
    floorIds: draft.floorIds,
    pointIds: draft.pointIds,
    cycle: draft.cycle,
    startDate: draft.startDate,
    endDate: draft.endDate,
    owner: draft.owner,
    executorRole: draft.executorRole,
    checklist: draft.checklist,
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

describe('确定性主键不误合并', () => {
  it('不同提交标识推出不同主键（不用哈希，不存在碰撞面）', () => {
    const a = issueIdOf('inspection:pnt_1:探头松动:1')
    const b = issueIdOf('inspection:pnt_1:外观破损:1')
    const c = issueIdOf('inspection:pnt_1:探头松动:2')
    expect(new Set([a, b, c]).size).toBe(3)
    expect(a).not.toBe(b)
    // 同一标识稳定得到同一主键
    expect(issueIdOf('inspection:pnt_1:探头松动:1')).toBe(a)
  })

  it('主键已被别的提交占用时立即报错，绝不静默复用', async () => {
    const tasks = await setup()
    const issues = useIssueStore()
    await issues.reload()
    const created = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '第一次发现',
      photos: [],
    })
    expect(created.ok).toBe(true)

    // 人为把那条问题的提交标识改成别的（模拟主键规则变化或数据被外部改写）
    const row = await db.issues.get(created.issue?.id ?? '')
    await db.issues.put({ ...row!, submissionKey: 'inspection:别处:别的问题:99' })

    await expect(
      tasks.reportInspectionIssue(taskKey, 'pnt_1', { anomalyType: '探头松动', description: '第二次发现', photos: [] }),
    ).rejects.toThrow('问题主键冲突')
  })
})

describe('并发提交', () => {
  it('同一提交并发两次：1 条问题、1 条关联、2 条日志', async () => {
    const tasks = await setup()
    const payload = { anomalyType: '探头松动', description: '并发提交', photos: [] }
    await Promise.all([
      tasks.reportInspectionIssue(taskKey, 'pnt_1', payload),
      tasks.reportInspectionIssue(taskKey, 'pnt_1', payload),
    ])
    expect(await db.issues.count()).toBe(1)
    expect(await db.tasks.count()).toBe(1)
    const issueLogs = (await db.audits.toArray()).filter((row) => row.summary.includes('提交巡检问题'))
    const linkLogs = (await db.audits.toArray()).filter((row) => row.summary.includes('任务关联问题'))
    expect(issueLogs).toHaveLength(1)
    expect(linkLogs).toHaveLength(1)
    const stored = await db.tasks.get(taskKey)
    expect(stored?.results[0].issueIds).toHaveLength(1)
  })
})

describe('缓存过期不影响判定', () => {
  it('问题已关闭后不能再作为处置依据（读库而非读缓存）', async () => {
    const tasks = await setup()
    const issues = useIssueStore()
    await issues.reload()
    const created = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '支架松动',
      photos: [],
    })
    await issues.reload()

    // 直接改库把这条问题关掉（模拟别处已处理完），但不清 Issue Store 的内存缓存
    const row = await db.issues.get(created.issue?.id ?? '')
    await db.issues.put({ ...row!, status: 'closed' })

    await tasks.attemptCheckIn(taskKey, 'pnt_1', { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', at: AT })
    const out = await tasks.completePointCheck(taskKey, 'pnt_1', {
      answers: [{ key: 'surface', label: '外观是否完好', result: 'abnormal', note: '' }],
      linkedIssueId: created.issue?.id ?? null,
      noIssueReason: '',
    })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('无需建问题')
  })

  it('问题在库里被删掉后关联被拒（缓存里还有也不认）', async () => {
    const tasks = await setup()
    const issues = useIssueStore()
    await issues.reload()
    const created = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '支架松动',
      photos: [],
    })
    await issues.reload()
    await db.issues.delete(created.issue?.id ?? '')

    const linked = await tasks.linkIssueToPoint(taskKey, 'pnt_1', created.issue?.id ?? '')
    expect(linked.ok).toBe(false)
    expect(linked.error).toContain('问题不存在')
  })
})

describe('审计写入失败要回滚', () => {
  it('到点时的日志写入失败 → 任务状态、尝试记录、问题关联都不变', async () => {
    const tasks = await setup()
    const issues = useIssueStore()
    await issues.reload()
    const created = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '先建立一条关联',
      photos: [],
    })
    const before = await db.tasks.get(taskKey)

    const original = db.audits.bulkPut.bind(db.audits)
    ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟日志写入失败')
    }
    let failed = false
    try {
      await tasks.attemptCheckIn(taskKey, 'pnt_1', {
        labelRead: 'NFC-B03-F2-CRACK01',
        method: 'nfc',
        fallbackReason: '',
        at: AT,
      })
    } catch {
      failed = true
    } finally {
      ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = original
    }

    expect(failed).toBe(true)
    const after = await db.tasks.get(taskKey)
    expect(after?.results[0].status).toBe(before?.results[0].status)
    expect(after?.results[0].attempts).toHaveLength(before?.results[0].attempts.length ?? 0)
    expect(after?.results[0].abnormalHandling.linkedIssueId).toBe(created.issue?.id)
    expect(after?.status).toBe(before?.status)

    // 恢复后到点仍能正常完成
    const retry = await tasks.attemptCheckIn(taskKey, 'pnt_1', {
      labelRead: 'NFC-B03-F2-CRACK01',
      method: 'nfc',
      fallbackReason: '',
      at: AT,
    })
    expect(retry.ok).toBe(true)
    expect(retry.task?.results[0].status).toBe('arrived')
  })

  it('完成检查时的日志写入失败 → 点位仍是已到点、清单未提交', async () => {
    const tasks = await setup()
    await tasks.attemptCheckIn(taskKey, 'pnt_1', { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', at: AT })
    const before = await db.tasks.get(taskKey)

    const original = db.audits.bulkPut.bind(db.audits)
    ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟日志写入失败')
    }
    let failed = false
    try {
      await tasks.completePointCheck(taskKey, 'pnt_1', {
        answers: [{ key: 'surface', label: '外观是否完好', result: 'ok', note: '' }],
        linkedIssueId: null,
        noIssueReason: '',
      })
    } catch {
      failed = true
    } finally {
      ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = original
    }

    expect(failed).toBe(true)
    const after = await db.tasks.get(taskKey)
    expect(after?.results[0].status).toBe(before?.results[0].status)
    expect(after?.status).toBe(before?.status)
  })
})
