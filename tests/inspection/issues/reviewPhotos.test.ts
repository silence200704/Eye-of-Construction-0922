/**
 * 审核随附现场照片的写入测试（V1-B.1）。
 *
 * 口径：照片**不先单独入库**，而是与问题状态、审核时间线、审计日志（转维修时还有工单）
 * 在同一个 IndexedDB 事务里提交。任一环节失败就整体回滚 ——
 * 否则会留下"附件已经挂在问题上、审核结论却没落库"的半成品，看起来像有处置依据。
 *
 * 另有一条：附件主键由草稿标识确定性推出，所以同一张草稿重复提交只会覆盖同一行，
 * 不会留下两条一模一样的照片（照片重复上传在工单侧出过一次）。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useArchiveStore } from '@/stores/archive'
import { useSessionStore } from '@/stores/session'
import { useIssueStore } from '@/stores/inspection/issues'
import { attachmentIdOf, type DraftPhotoInput } from '@/db/inspection/attachments'
import { makeBuilding, makeFloor, makePoint } from '../../fixtures'

const AT = '2026-09-20T09:00:00.000Z'
const BLD = makeBuilding({ id: 'bld_1' })
const FLR = makeFloor({ id: 'flr_1', buildingId: 'bld_1', zones: ['二层走廊'] })
const PNT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', buildingId: 'bld_1', floorId: 'flr_1', zoneId: '二层走廊' })

/** 一张草稿（页面上的 PhotoUploader 已经压过图，这里直接给压缩后的字节） */
function draft(id = 'draft_1'): DraftPhotoInput {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3])
  return {
    id,
    fileName: '现场照片.jpg',
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    thumb: new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }),
    size: bytes.length,
    width: 640,
    height: 480,
    capturedAt: AT,
  }
}

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

async function makeIssue(description = '探头支架松动'): Promise<string> {
  const issues = useIssueStore()
  const out = await issues.reportManualIssue({
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    anomalyType: '探头松动',
    description,
    photos: [],
    detail: description,
  })
  await issues.reload()
  return out.issue.id
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('审核随附照片的原子性', () => {
  it('带照片的审核：问题、附件、时间线同一次提交成立', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makeIssue()

    const out = await issues.reviewIssue(id, {
      action: 'close_no_fault',
      category: 'handled',
      note: '现场已用水泥砂浆临时封堵处理完毕，留观无异常',
      photoDrafts: [draft()],
    })
    expect(out.ok).toBe(true)

    const issue = await db.issues.get(id)
    expect(issue?.status).toBe('closed')
    expect(issue?.photos).toEqual([attachmentIdOf('draft_1')])
    expect(issue?.timeline.at(-1)?.detail).toContain('现场照片 1 张')

    const rows = await db.attachments.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(attachmentIdOf('draft_1'))
    expect(rows[0].issueId).toBe(id)
    expect(rows[0].blob).toBeInstanceOf(Blob)
  })

  it('附件写库失败时问题也不落地（不留"问题已关闭、照片没挂上"）', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makeIssue()
    const before = await db.issues.get(id)

    const original = db.attachments.bulkPut.bind(db.attachments)
    ;(db.attachments as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟附件写入失败')
    }
    let failed = false
    try {
      await issues.reviewIssue(id, {
        action: 'close_no_fault',
        category: 'handled',
        note: '现场已用水泥砂浆临时封堵处理完毕，留观无异常',
        photoDrafts: [draft()],
      })
    } catch {
      failed = true
    } finally {
      ;(db.attachments as unknown as { bulkPut: unknown }).bulkPut = original
    }

    expect(failed).toBe(true)
    const after = await db.issues.get(id)
    expect(after?.status).toBe(before?.status)
    expect(after?.photos).toEqual([])
    expect(after?.timeline).toHaveLength(before?.timeline.length ?? 0)
    expect(await db.attachments.count()).toBe(0)

    // 恢复后重试：照片与审核一起成立
    const retry = await issues.reviewIssue(id, {
      action: 'close_no_fault',
      category: 'handled',
      note: '现场已用水泥砂浆临时封堵处理完毕，留观无异常',
      photoDrafts: [draft()],
    })
    expect(retry.ok).toBe(true)
    expect(await db.attachments.count()).toBe(1)
  })

  it('问题写库失败时附件也不落地', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makeIssue()

    const original = db.issues.put.bind(db.issues)
    ;(db.issues as unknown as { put: unknown }).put = () => {
      throw new Error('模拟问题写入失败')
    }
    let failed = false
    try {
      await issues.reviewIssue(id, {
        action: 'close_no_fault',
        category: 'handled',
        note: '现场已用水泥砂浆临时封堵处理完毕，留观无异常',
        photoDrafts: [draft()],
      })
    } catch {
      failed = true
    } finally {
      ;(db.issues as unknown as { put: unknown }).put = original
    }

    expect(failed).toBe(true)
    expect(await db.attachments.count()).toBe(0)
  })

  it('转维修工单时照片随工单一起成立', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makeIssue()

    const out = await issues.reviewIssue(id, {
      action: 'to_repair',
      category: 'equipment',
      note: '现场确认可维修，转维修工单处理',
      photoDrafts: [draft()],
    })
    expect(out.ok).toBe(true)
    expect(await db.workOrders.count()).toBe(1)
    const issue = await db.issues.get(id)
    expect(issue?.photos).toEqual([attachmentIdOf('draft_1')])
    expect(await db.attachments.count()).toBe(1)
  })

  it('同一张草稿重复提交不会留下两条重复照片（附件主键确定性推出）', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makeIssue()

    const payload = {
      action: 'close_no_fault' as const,
      category: 'handled',
      note: '现场已用水泥砂浆临时封堵处理完毕，留观无异常',
      photoDrafts: [draft()],
    }
    // 第一次提交被拦（说明不足），随后用同一张草稿成功提交
    const denied = await issues.reviewIssue(id, { ...payload, note: '太短' })
    expect(denied.ok).toBe(false)
    expect(await db.attachments.count()).toBe(0)

    await issues.reviewIssue(id, payload)
    await db.issues.get(id)
    expect(await db.attachments.count()).toBe(1)
    expect((await db.issues.get(id))?.photos).toEqual([attachmentIdOf('draft_1')])
  })

  it('不带照片时「已当场处理」被拦（判定取本次操作后的照片数）', async () => {
    await setup()
    const issues = useIssueStore()
    const id = await makeIssue()

    const denied = await issues.reviewIssue(id, {
      action: 'close_no_fault',
      category: 'handled',
      note: '现场已用水泥砂浆临时封堵处理完毕，留观无异常',
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('现场照片')
    expect((await db.issues.get(id))?.status).toBe('pending_review')
  })
})
