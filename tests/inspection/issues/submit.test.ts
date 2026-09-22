/**
 * 问题提交的仓储行为测试（跑在真实 IndexedDB 行为上）。
 * 口径：同一次提交重试不重复建单；照片挂到问题上不留游离附件；跨来源疑似重复只提示不合并。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useIssueStore } from '@/stores/inspection/issues'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { scanIntegrity } from '@/core/integrity'
import { putAttachment } from '@/db/repo'
import { planPhotoSync } from '@/db/inspection/attachments'
import type { IssueAttachment } from '@/types/inspection'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })

/**
 * 直接构造一条附件记录。
 * 压缩（createImageBitmap + canvas）只在浏览器里可用，这里跳过压缩这一步，
 * 只验证"附件与问题的挂接关系"——压缩与预算由附件预算测试与浏览器实测覆盖。
 */
function attachmentRow(override: Partial<IssueAttachment> = {}): IssueAttachment {
  return {
    id: 'att_1',
    issueId: null,
    workOrderId: null,
    kind: 'scene',
    fileName: '现场.jpg',
    mimeType: 'image/jpeg',
    draftId: '',
    size: 200,
    width: 640,
    height: 480,
    uploadedAt: AT,
    uploadedBy: '巡检人员',
    capturedAt: AT,
    blob: new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }),
    thumb: new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }),
    ...override,
  }
}

function draft(override: Partial<Parameters<ReturnType<typeof useIssueStore>['reportManualIssue']>[0]> = {}) {
  return {
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    anomalyType: '探头松动',
    description: '探头支架螺栓松动，轻碰有位移',
    photos: [] as string[],
    detail: '现场巡查发现：探头支架螺栓松动',
    ...override,
  }
}

beforeEach(async () => {
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
  session.name = '巡检人员'
  session.role = 'inspector'
})

describe('问题提交与去重', () => {
  it('首次提交建单，编号按日期生成、状态为待审核（人工上报不带任务）', async () => {
    const issues = useIssueStore()
    await issues.reload()
    const out = await issues.reportManualIssue(draft())
    expect(out.duplicated).toBe(false)
    expect(out.issue.issueNo).toMatch(/^ISS-\d{8}-\d{3}$/)
    expect(out.issue.status).toBe('pending_review')
    expect(out.issue.timeline.map((row) => row.action)).toEqual(['提交问题'])
    expect(await db.issues.count()).toBe(1)
  })

  it('同一次提交重试（同来源/位置/异常/时间窗）不重复建单', async () => {
    const issues = useIssueStore()
    await issues.reload()
    const first = await issues.reportManualIssue(draft())
    const second = await issues.reportManualIssue(draft())
    expect(second.duplicated).toBe(true)
    expect(second.issue.id).toBe(first.issue.id)
    expect(await db.issues.count()).toBe(1)
  })

  it('不同异常类型各自建单，不会被误判成重复', async () => {
    const issues = useIssueStore()
    await issues.reload()
    await issues.reportManualIssue(draft())
    await issues.reportManualIssue(draft({ anomalyType: '渗水受潮', description: '墙角渗水' }))
    expect(await db.issues.count()).toBe(2)
  })

  it('疑似重复只给候选、不自动合并；同一次提交重试才去重', async () => {
    const issues = useIssueStore()
    await issues.reload()
    await issues.reportManualIssue(draft())

    // 候选查询不看来源：同位置 + 同异常类型 + 未关闭 + 时间窗内即命中
    const candidates = issues.duplicatesFor({
      pointId: 'pnt_1',
      buildingId: 'bld_1',
      zoneId: '二层走廊',
      anomalyType: '探头松动',
      at: new Date().toISOString(),
    })
    expect(candidates).toHaveLength(1)

    // 同一次提交重试 → 复用，不重复建单
    const retry = await issues.reportManualIssue(draft())
    expect(retry.duplicated).toBe(true)
    expect(await db.issues.count()).toBe(1)

    // 但候选只是提示，不阻断真正的新问题（换异常类型即另一件事）
    const other = await issues.reportManualIssue(draft({ anomalyType: '外观破损', description: '外壳有裂痕' }))
    expect(other.duplicated).toBe(false)
    expect(await db.issues.count()).toBe(2)
  })
})

describe('照片入库但关联失败时的重试', () => {
  it('重试只补关联：附件总数仍为 1，问题照片列表恢复关联', async () => {
    const issues = useIssueStore()
    await issues.reload()
    const out = await issues.reportManualIssue(draft())

    // 第一步：附件入库成功（带草稿标识）
    await putAttachment(attachmentRow({ id: 'att_x', issueId: out.issue.id, draftId: 'draft_1' }))
    // 第二步：假设"关联到问题"这一步失败 —— 问题里没有这张照片
    let stored = await db.issues.get(out.issue.id)
    expect(stored?.photos).toEqual([])

    // 重试：先认人再上传 —— 认出这张草稿已入库，于是只补关联
    const plan = planPhotoSync([{ id: 'draft_1' }], await db.attachments.where('issueId').equals(out.issue.id).toArray(), stored?.photos ?? [])
    expect(plan.toUpload).toEqual([])
    expect(plan.toLink.map((row) => row.attachmentId)).toEqual(['att_x'])

    for (const item of plan.toLink) await issues.attachPhotos(out.issue.id, [item.attachmentId])

    stored = await db.issues.get(out.issue.id)
    expect(stored?.photos).toEqual(['att_x'])
    expect(await db.attachments.count()).toBe(1)
  })

  it('对照：不认草稿标识就会重复入库（说明这个修复要解决什么）', async () => {
    const issues = useIssueStore()
    await issues.reload()
    const out = await issues.reportManualIssue(draft())
    await putAttachment(attachmentRow({ id: 'att_y', issueId: out.issue.id, draftId: '' }))
    // draftId 为空的旧数据认不出来，按"缺失"处理 —— 这正是修复前的行为
    const plan = planPhotoSync([{ id: 'draft_1' }], await db.attachments.where('issueId').equals(out.issue.id).toArray(), [])
    expect(plan.toUpload.map((row) => row.id)).toEqual(['draft_1'])
  })
})

describe('照片挂接', () => {
  it('问题先建、照片再挂：照片 ID 出现在问题里，附件也关联到问题', async () => {
    const issues = useIssueStore()
    await issues.reload()
    const out = await issues.reportManualIssue(draft())
    await putAttachment(attachmentRow({ issueId: out.issue.id }))
    await issues.attachPhotos(out.issue.id, ['att_1'])

    const stored = await db.issues.get(out.issue.id)
    expect(stored?.photos).toEqual(['att_1'])
    expect(stored?.timeline.at(-1)?.action).toBe('补充照片')
    const att = await db.attachments.get('att_1')
    expect(att?.issueId).toBe(out.issue.id)
  })

  it('同一张照片重复挂接不会重复计入', async () => {
    const issues = useIssueStore()
    await issues.reload()
    const out = await issues.reportManualIssue(draft())
    await putAttachment(attachmentRow({ issueId: out.issue.id }))
    await issues.attachPhotos(out.issue.id, ['att_1'])
    await issues.attachPhotos(out.issue.id, ['att_1'])
    const stored = await db.issues.get(out.issue.id)
    expect(stored?.photos).toEqual(['att_1'])
  })

  it('游离附件（既不关联问题也不关联工单）会被完整性检查报出来', async () => {
    await putAttachment(attachmentRow({ id: 'att_free', fileName: '游离.jpg' }))
    const rows = await db.attachments.toArray()
    const found = scanIntegrity({
      buildings: [BLD],
      floors: [FLR],
      points: [PNT],
      devices: [],
      baselines: [],
      records: [],
      events: [],
      plans: [],
      tasks: [],
      issues: [],
      workOrders: [],
      attachments: rows,
    })
    expect(found.map((row) => row.kind)).toContain('附件未关联对象')
  })
})
