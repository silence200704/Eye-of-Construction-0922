/**
 * 任务写入的受控入口测试（P0：页面不能绕过业务规则写库）。
 *
 * 口径：
 * ① 页面无法直接写结果 —— 只有 attemptCheckIn / completePointCheck / linkIssueToPoint 三个入口；
 * ② 入口内校验执行角色：非执行角色一律拒绝，且数据库保持不变；
 * ③ 未到点不能提交完成；异常未关联真实问题又没有依据时不能提交；
 * ④ 关联的问题必须存在、且属于本任务与点位；
 * ⑤ 补传照片只补缺失的那几张（纯函数）。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { planPhotoSync } from '@/db/inspection/attachments'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useIssueStore } from '@/stores/inspection/issues'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import type { ChecklistAnswer, InspectionPlan } from '@/types/inspection'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })

const CHECKLIST = [
  { key: 'surface', label: '外观是否完好', required: true, hint: '' },
  { key: 'fixing', label: '固定是否牢靠', required: true, hint: '' },
]

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

const answers = (abnormal: boolean): ChecklistAnswer[] => [
  { key: 'surface', label: '外观是否完好', result: 'ok', note: '' },
  { key: 'fixing', label: '固定是否牢靠', result: abnormal ? 'abnormal' : 'ok', note: '' },
]

/** 任务主键由"计划 ID + 执行时刻"组成，计划 ID 是运行时生成的，测试里从库里取真值 */
let taskKey = ''

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

async function stored(): Promise<{ status: string; results: unknown }> {
  const row = await db.tasks.get(taskKey)
  return { status: row?.status ?? 'missing', results: row?.results ?? null }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('受控入口：角色校验', () => {
  it('非执行角色（安全管理人员）不能到点、不能提交完成，数据库不变', async () => {
    const tasks = await setup('safety')
    const before = await stored()

    const checkIn = await tasks.attemptCheckIn(taskKey, 'pnt_1', { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', at: AT })
    expect(checkIn.ok).toBe(false)
    expect(checkIn.error).toContain('执行角色')

    const complete = await tasks.completePointCheck(taskKey, 'pnt_1', { answers: answers(false), linkedIssueId: null, noIssueReason: '' })
    expect(complete.ok).toBe(false)

    expect(await stored()).toEqual(before)
  })

  it('执行角色可以到点，但状态只到"已到点"', async () => {
    const tasks = await setup('inspector')
    const out = await tasks.attemptCheckIn(taskKey, 'pnt_1', { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', at: AT })
    expect(out.ok).toBe(true)
    const row = out.task?.results.find((item) => item.pointId === 'pnt_1')
    expect(row?.status).toBe('arrived')
    const state = await stored()
    expect(state.status).toBe('pending')
  })
})

describe('受控入口：完成检查的前置条件', () => {
  it('未到点不能提交完成', async () => {
    const tasks = await setup('inspector')
    const before = await stored()
    const out = await tasks.completePointCheck(taskKey, 'pnt_1', { answers: answers(false), linkedIssueId: null, noIssueReason: '' })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('尚未到点')
    expect(await stored()).toEqual(before)
  })

  it('必答项没答完不能提交，且数据库不变', async () => {
    const tasks = await setup('inspector')
    await tasks.attemptCheckIn(taskKey, 'pnt_1', { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', at: AT })
    const before = await stored()
    const partial: ChecklistAnswer[] = [
      { key: 'surface', label: '外观是否完好', result: 'ok', note: '' },
      { key: 'fixing', label: '固定是否牢靠', result: null, note: '' },
    ]
    const out = await tasks.completePointCheck(taskKey, 'pnt_1', { answers: partial, linkedIssueId: null, noIssueReason: '' })
    expect(out.ok).toBe(false)
    expect(await stored()).toEqual(before)
  })

  it('异常项未关联真实问题时，只有写明依据才能提交，并把依据写进日志', async () => {
    const tasks = await setup('inspector')
    await tasks.attemptCheckIn(taskKey, 'pnt_1', { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', at: AT })

    const denied = await tasks.completePointCheck(taskKey, 'pnt_1', { answers: answers(true), linkedIssueId: null, noIssueReason: '没事' })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('无需建问题')

    const ok = await tasks.completePointCheck(taskKey, 'pnt_1', {
      answers: answers(true),
      linkedIssueId: null,
      noIssueReason: '支架轻微晃动但读数稳定，现场观察后判断无需建问题',
    })
    expect(ok.ok).toBe(true)
    const logs = await db.audits.toArray()
    const reason = logs.filter((row) => row.summary.includes('检查项异常但未建问题'))
    expect(reason).toHaveLength(1)
    expect(reason[0].reason).toContain('无需建问题依据')
  })

  it('关联的问题必须属于本任务与点位，否则不算处置证据', async () => {
    const tasks = await setup('inspector')
    const issues = useIssueStore()
    await issues.reload()
    await tasks.attemptCheckIn(taskKey, 'pnt_1', { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', at: AT })

    // 造一条别的点位（别的任务）的问题：用人工上报入口，它不带任务
    const other = await issues.reportManualIssue({
      pointId: null,
      buildingId: 'bld_1',
      floorId: 'flr_1',
      zoneId: '二层走廊',
      anomalyType: '探头松动',
      description: '别处的问题',
      photos: [],
      detail: '别处',
    })

    const denied = await tasks.completePointCheck(taskKey, 'pnt_1', { answers: answers(true), linkedIssueId: other.issue.id, noIssueReason: '' })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('无需建问题')
  })

  it('关联到本条问题后可以提交，并把问题 ID 记进结果', async () => {
    const tasks = await setup('inspector')
    const issues = useIssueStore()
    await issues.reload()
    await tasks.attemptCheckIn(taskKey, 'pnt_1', { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', at: AT })

    const created = await tasks.reportInspectionIssue(taskKey, 'pnt_1', {
      anomalyType: '探头松动',
      description: '支架螺栓松动',
      photos: [],
    })
    expect(created.ok).toBe(true)
    const out = await tasks.completePointCheck(taskKey, 'pnt_1', { answers: answers(true), linkedIssueId: created.issue?.id ?? null, noIssueReason: '' })
    expect(out.ok).toBe(true)
    const row = out.task?.results.find((item) => item.pointId === 'pnt_1')
    expect(row?.status).toBe('completed')
    expect(row?.abnormalHandling.linkedIssueId).toBe(created.issue?.id)
    expect(row?.issueIds).toEqual([created.issue?.id])
    // 未写"无需建问题"日志：因为已经建了问题
    const logs = await db.audits.toArray()
    expect(logs.filter((entry) => entry.summary.includes('检查项异常但未建问题'))).toHaveLength(0)
  })

  it('点位不在本任务范围内时被拒绝', async () => {
    const tasks = await setup('inspector')
    const out = await tasks.attemptCheckIn(taskKey, 'pnt_gone', { labelRead: 'X', method: 'nfc', fallbackReason: '', at: AT })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('不在本任务范围')
  })
})

describe('照片同步计划（纯函数）', () => {
  const drafts = [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }]
  const existing = (rows: { id: string; draftId: string }[]) => rows

  it('第一张入库并关联成功、第二张失败：重试只上传第二、三张', () => {
    const plan = planPhotoSync(drafts, existing([{ id: 'att_1', draftId: 'd1' }]), ['att_1'])
    expect(plan.toUpload.map((row) => row.id)).toEqual(['d2', 'd3'])
    expect(plan.toLink).toEqual([])
  })

  it('附件已入库但关联失败：只补关联，不再上传（避免重复附件）', () => {
    const plan = planPhotoSync(drafts, existing([{ id: 'att_1', draftId: 'd1' }]), [])
    expect(plan.toUpload.map((row) => row.id)).toEqual(['d2', 'd3'])
    expect(plan.toLink.map((row) => [row.draft.id, row.attachmentId])).toEqual([['d1', 'att_1']])
  })

  it('全部已入库且已关联：没有要做的事', () => {
    const rows = [
      { id: 'att_1', draftId: 'd1' },
      { id: 'att_2', draftId: 'd2' },
      { id: 'att_3', draftId: 'd3' },
    ]
    const plan = planPhotoSync(drafts, existing(rows), ['att_1', 'att_2', 'att_3'])
    expect(plan.toUpload).toEqual([])
    expect(plan.toLink).toEqual([])
  })

  it('没有草稿时返回空计划', () => {
    expect(planPhotoSync([], [], [])).toEqual({ toLink: [], toUpload: [] })
  })
})
