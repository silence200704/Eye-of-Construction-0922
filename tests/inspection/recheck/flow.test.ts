/**
 * 复查与观察期测试（V1-C）。
 *
 * 口径：验收通过只把问题推进到"待复查"，之后**必须登记**复查事项、责任人与目标日期；
 * 结论三态由人明确选择（确认恢复 / 继续观察 / 复发转处置）；逾期只进待办并标出天数，
 * 系统不替人下结论、也不因为逾期就关问题。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { useIssueStore } from '@/stores/inspection/issues'
import { activeRound, planRecheckOutcome, planRecheckRegister, recheckState, roundsOf } from '@/core/inspection/recheck'
import { isValidDayKey } from '@/core/time'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'
import { makeBuilding, makeEvent, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })

function issue(override: Partial<InspectionIssue> = {}): InspectionIssue {
  return {
    ...AUDIT,
    id: 'iss_1',
    issueNo: 'ISS-20260920-001',
    source: 'report',
    submissionKey: 'report:pnt_1:裂缝扩展:1',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    eventId: null,
    taskId: null,
    anomalyType: '裂缝扩展',
    description: '墙面裂缝',
    photos: [],
    status: 'pending_recheck',
    reviewAction: 'to_repair',
    reviewCategory: 'equipment',
    reviewedAt: AT,
    reviewedBy: '张工',
    reviewNote: '转维修',
    duplicateOf: null,
    linkedEventId: null,
    linkedFrom: [],
    workOrderIds: [],
    rechecks: [],
    timeline: [],
    ...override,
  }
}

const openRound = { subject: '复测裂缝宽度并留观', owner: '李老师', dueDate: '2026-09-25' }

/* ---------------- 登记与结论（纯函数） ---------------- */

describe('复查登记', () => {
  it('事项、责任人、目标日期缺一不可', () => {
    expect(planRecheckRegister({ issue: issue(), subject: '看看', owner: '李老师', dueDate: '2026-09-25', at: AT, by: '张工' }).ok).toBe(false)
    expect(planRecheckRegister({ issue: issue(), subject: '复测裂缝宽度', owner: '  ', dueDate: '2026-09-25', at: AT, by: '张工' }).error).toContain('责任人')
    expect(planRecheckRegister({ issue: issue(), subject: '复测裂缝宽度', owner: '李老师', dueDate: '', at: AT, by: '张工' }).error).toContain('目标日期')
  })

  it('只有待复查 / 观察中的问题需要登记', () => {
    for (const status of ['pending_review', 'repairing', 'closed'] as const) {
      const out = planRecheckRegister({ issue: issue({ status }), ...openRound, at: AT, by: '张工' })
      expect(out.ok).toBe(false)
      expect(out.error).toContain('待复查')
    }
    expect(planRecheckRegister({ issue: issue({ status: 'observing' }), ...openRound, at: AT, by: '张工' }).ok).toBe(true)
  })

  it('已有一轮未出结论时不能再登记下一轮', () => {
    const first = planRecheckRegister({ issue: issue(), ...openRound, at: AT, by: '张工' })
    const withRound = issue({ rechecks: [first.round!] })
    const again = planRecheckRegister({ issue: withRound, ...openRound, at: AT, by: '张工' })
    expect(again.ok).toBe(false)
    expect(again.error).toContain('先记录复查结论')
  })
})

describe('复查到期口径', () => {
  const registered = (dueDate: string): InspectionIssue => {
    const out = planRecheckRegister({ issue: issue(), subject: '复测裂缝宽度并留观', owner: '李老师', dueDate, at: AT, by: '张工' })
    return issue({ rechecks: [out.round!] })
  }

  it('未到目标日期是待到，当天是到期日，过了就是逾期并给出天数', () => {
    expect(recheckState(registered('2026-09-25'), '2026-09-20').state).toBe('awaiting')
    expect(recheckState(registered('2026-09-25'), '2026-09-25').state).toBe('due')
    const late = recheckState(registered('2026-09-25'), '2026-09-28')
    expect(late.state).toBe('overdue')
    expect(late.overdueDays).toBe(3)
  })

  it('不是复查链条上的问题不参与逾期统计', () => {
    expect(recheckState(issue({ status: 'repairing' }), '2026-09-28').state).toBe('none')
    expect(recheckState(issue({ status: 'closed' }), '2026-09-28').state).toBe('none')
  })

  it('未登记复查的待复查问题不算逾期（只是"还没有复查安排"）', () => {
    const state = recheckState(issue(), '2026-09-28')
    expect(state.state).toBe('none')
    expect(activeRound(issue())).toBeUndefined()
  })
})

describe('复查结论三态', () => {
  const registered = (status: InspectionIssue['status'] = 'pending_recheck'): InspectionIssue => {
    const out = planRecheckRegister({ issue: issue({ status }), subject: '复测裂缝宽度并留观', owner: '李老师', dueDate: '2026-09-25', at: AT, by: '张工' })
    return issue({ status, rechecks: [out.round!] })
  }
  const act = (base: InspectionIssue, outcome: 'recovered' | 'observing' | 'recurred', note = '现场复测裂缝未继续扩展，石膏条完好', nextDueDate?: string) =>
    planRecheckOutcome({ issue: base, outcome, note, nextDueDate, at: '2026-09-26T09:00:00.000Z', by: '李老师', byRole: '巡检人员' })

  it('确认恢复：问题关闭，轮次写入结论', () => {
    const out = act(registered(), 'recovered')
    expect(out.ok).toBe(true)
    expect(out.next?.status).toBe('closed')
    expect(roundsOf(out.next!)).toHaveLength(1)
    expect(roundsOf(out.next!)[0].outcome).toBe('recovered')
    expect(out.next?.timeline.at(-1)?.action).toBe('复查：确认恢复')
  })

  it('继续观察：进入观察中，并自动开出下一轮（目标日期必填）', () => {
    const missing = act(registered(), 'observing')
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('下一次复查的目标日期')

    const out = act(registered(), 'observing', '读数仍有小幅波动，再观察一个周期', '2026-10-05')
    expect(out.next?.status).toBe('observing')
    const rounds = roundsOf(out.next!)
    expect(rounds).toHaveLength(2)
    expect(rounds[0].outcome).toBe('observing')
    expect(rounds[1].outcome).toBeNull()
    expect(rounds[1].dueDate).toBe('2026-10-05')
    // 下一轮沿用同一责任人
    expect(rounds[1].owner).toBe('李老师')
  })

  it('复发转处置：退回待审核，原问题不新建', () => {
    const out = act(registered('observing'), 'recurred', '裂缝重新扩展并伴随渗水，需重新处置')
    expect(out.next?.status).toBe('pending_review')
    expect(out.next?.id).toBe('iss_1')
    expect(out.next?.timeline.at(-1)?.detail).toContain('不新建无关问题')
  })

  it('结论说明太短被拒', () => {
    expect(act(registered(), 'recovered', '好了').ok).toBe(false)
  })

  it('没有未结轮次时不能直接下结论（必须先登记）', () => {
    const out = act(issue(), 'recovered')
    expect(out.ok).toBe(false)
    expect(out.error).toContain('请先登记复查事项')
  })

  it('原工单与事件会写进时间线，事后能回看', () => {
    const out = planRecheckOutcome({
      issue: registered(),
      outcome: 'recurred',
      note: '裂缝重新扩展并伴随渗水，需重新处置',
      reference: '原工单 WO-20260920-001、预警事件 E20260920-001',
      at: '2026-09-26T09:00:00.000Z',
      by: '李老师',
      byRole: '巡检人员',
    })
    expect(out.next?.timeline.at(-1)?.detail).toContain('WO-20260920-001')
    expect(out.next?.timeline.at(-1)?.detail).toContain('E20260920-001')
  })
})

/* ---------------- 仓储：权限与留痕 ---------------- */

async function setup(role = 'safety'): Promise<void> {
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
}

async function makePendingRecheck(): Promise<string> {
  const issues = useIssueStore()
  const created = await issues.reportManualIssue({
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    anomalyType: '裂缝扩展',
    description: '墙面裂缝',
    photos: [],
    detail: '现场上报',
  })
  await db.issues.update(created.issue.id, { status: 'pending_recheck' })
  await issues.reload()
  return created.issue.id
}

describe('复查写入的权限与留痕', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('非安全管理人员既不能登记也不能下结论，且数据库不变', async () => {
    await setup('inspector')
    const issues = useIssueStore()
    const id = await makePendingRecheck()
    const before = JSON.stringify(await db.issues.get(id))
    const logsBefore = await db.audits.count()

    const denied = await issues.registerRecheck(id, openRound)
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('学校安全管理人员')

    const deniedOutcome = await issues.recordRecheckOutcome(id, { outcome: 'recovered', note: '复测未见新裂缝，石膏条完好' })
    expect(deniedOutcome.ok).toBe(false)
    expect(deniedOutcome.error).toContain('学校安全管理人员')

    expect(JSON.stringify(await db.issues.get(id))).toBe(before)
    expect(await db.audits.count()).toBe(logsBefore)

    // 换成安全管理人员后同一个调用就能成功 —— 证明前面拒绝的是权限，不是数据有问题
    useSessionStore().role = 'safety'
    const ok = await issues.registerRecheck(id, openRound)
    expect(ok.ok).toBe(true)
  })

  it('登记复查：问题、时间线、审计日志一起落库', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makePendingRecheck()
    const logsBefore = await db.audits.count()

    const out = await issues.registerRecheck(id, openRound)
    expect(out.ok).toBe(true)

    const row = await db.issues.get(id)
    expect(roundsOf(row!)).toHaveLength(1)
    expect(row?.timeline.at(-1)?.action).toBe('登记复查')
    expect(row?.timeline.at(-1)?.detail).toContain('责任人：李老师')
    expect(await db.audits.count()).toBe(logsBefore + 1)
  })

  it('下结论时把原工单与预警事件写进时间线，便于回看', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makePendingRecheck()
    const order: WorkOrder = {
      ...AUDIT,
      id: 'wo_1',
      orderNo: 'WO-20260920-001',
      origin: 'issue',
      issueId: id,
      eventId: null,
      pointId: 'pnt_1',
      title: '裂缝扩展处理',
      status: 'verified',
      assignee: '维修人员',
      assignedBy: '张工',
      assignedAt: AT,
      dueAt: null,
      measures: '封闭处理',
      materials: '',
      photos: [],
      submittedAt: AT,
      reviews: [],
      timeline: [],
    }
    const event = makeEvent({ id: 'evt_1', eventNo: 'E20260920-001' })
    await db.workOrders.put(order)
    await db.events.put(event)
    await db.issues.update(id, { workOrderIds: ['wo_1'], eventId: 'evt_1' })
    await issues.reload()

    await issues.registerRecheck(id, openRound)
    const out = await issues.recordRecheckOutcome(id, { outcome: 'recurred', note: '裂缝重新扩展并伴随渗水，需重新处置' })
    expect(out.ok).toBe(true)

    const detail = (await db.issues.get(id))?.timeline.at(-1)?.detail ?? ''
    expect(detail).toContain('WO-20260920-001')
    expect(detail).toContain('E20260920-001')
    expect((await db.issues.get(id))?.status).toBe('pending_review')
  })
})

/* ---------------- 日期合法性（V1-C.1） ---------------- */

describe('复查日期的合法性', () => {
  it('挡住日历上不存在的日期与错误格式', () => {
    for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-9-5', '2026/09/25', '260925', '']) {
      expect(isValidDayKey(bad)).toBe(false)
      const out = planRecheckRegister({ issue: issue(), subject: '复测裂缝宽度', owner: '李老师', dueDate: bad, at: AT, by: '张工' })
      expect(out.ok).toBe(false)
    }
  })

  it('真实存在的日期（含闰年 2 月 29 日）通过，历史日期也允许（演示逾期要用）', () => {
    for (const good of ['2026-09-25', '2024-02-29', '2026-09-18']) {
      expect(isValidDayKey(good)).toBe(true)
      expect(planRecheckRegister({ issue: issue(), subject: '复测裂缝宽度', owner: '李老师', dueDate: good, at: AT, by: '张工' }).ok).toBe(true)
    }
  })

  it('「继续观察」的下一次日期同样要过日历校验', () => {
    const first = planRecheckRegister({ issue: issue(), subject: '复测裂缝宽度并留观', owner: '李老师', dueDate: '2026-09-25', at: AT, by: '张工' })
    const registered = issue({ rechecks: [first.round!] })
    const bad = planRecheckOutcome({
      issue: registered,
      outcome: 'observing',
      note: '读数仍有小幅波动，再观察一个周期',
      nextDueDate: '2026-02-31',
      at: '2026-09-26T09:00:00.000Z',
      by: '李老师',
      byRole: '巡检人员',
    })
    expect(bad.ok).toBe(false)
    expect(bad.error).toContain('合法日期')
  })
})

/* ---------------- 并发与事务（V1-C.1 的 P0） ---------------- */

describe('复查写入的并发与事务', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('两次并发登记只成功一次：只留一轮复查、只留一条日志', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makePendingRecheck()
    const logsBefore = await db.audits.count()

    const [a, b] = await Promise.all([
      issues.registerRecheck(id, openRound),
      issues.registerRecheck(id, { subject: '另一套复查安排（并发）', owner: '周老师', dueDate: '2026-09-30' }),
    ])
    const okCount = [a, b].filter((row) => row.ok).length
    expect(okCount).toBe(1)

    const row = await db.issues.get(id)
    expect(roundsOf(row!)).toHaveLength(1)
    expect(row?.timeline.filter((item) => item.action === '登记复查')).toHaveLength(1)
    expect(await db.audits.count()).toBe(logsBefore + 1)
  })

  it('两次并发结论只成功一次：结论不会被覆盖', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makePendingRecheck()
    await issues.registerRecheck(id, openRound)
    const logsBefore = await db.audits.count()

    const [a, b] = await Promise.all([
      issues.recordRecheckOutcome(id, { outcome: 'recovered', note: '复测未见新裂缝，封闭层完好' }),
      issues.recordRecheckOutcome(id, { outcome: 'recurred', note: '裂缝重新扩展并伴随渗水，需重新处置' }),
    ])
    expect([a, b].filter((row) => row.ok).length).toBe(1)

    const row = await db.issues.get(id)
    const concluded = roundsOf(row!).filter((item) => item.outcome !== null)
    expect(concluded).toHaveLength(1)
    expect(row?.timeline.filter((item) => item.action.startsWith('复查：'))).toHaveLength(1)
    expect(await db.audits.count()).toBe(logsBefore + 1)
  })

  it('审计日志写入失败：返回失败结果（不抛异常）且问题行不变', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makePendingRecheck()
    const before = JSON.stringify(await db.issues.get(id))

    const original = db.audits.bulkPut.bind(db.audits)
    ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟日志写入失败')
    }
    let out: Awaited<ReturnType<typeof issues.registerRecheck>> | null = null
    try {
      // 仓储入口必须把事务异常转成失败结果 —— 页面只写了 try/finally 时，
      // 抛出去的异常就只剩一条控制台错误，用户看不到任何提示
      out = await issues.registerRecheck(id, openRound)
    } finally {
      ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = original
    }

    expect(out?.ok).toBe(false)
    expect(out?.error).toContain('保存失败，未写入数据')
    expect(out?.error).toContain('可重试')
    expect(JSON.stringify(await db.issues.get(id))).toBe(before)

    // 恢复后重试：登记与日志一起成立
    const retry = await issues.registerRecheck(id, openRound)
    expect(retry.ok).toBe(true)
    expect(roundsOf(await db.issues.get(id))).toHaveLength(1)
  })

  it('记录结论时的写入失败同样返回失败结果且状态不变', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makePendingRecheck()
    await issues.registerRecheck(id, openRound)
    const before = JSON.stringify(await db.issues.get(id))

    const original = db.audits.bulkPut.bind(db.audits)
    ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟日志写入失败')
    }
    let out: Awaited<ReturnType<typeof issues.recordRecheckOutcome>> | null = null
    try {
      out = await issues.recordRecheckOutcome(id, { outcome: 'recovered', note: '复测未见新裂缝，封闭层完好' })
    } finally {
      ;(db.audits as unknown as { bulkPut: unknown }).bulkPut = original
    }

    expect(out?.ok).toBe(false)
    expect(out?.error).toContain('保存失败，未写入数据')
    const row = await db.issues.get(id)
    expect(JSON.stringify(row)).toBe(before)
    expect(row?.status).toBe('pending_recheck')
  })
})
