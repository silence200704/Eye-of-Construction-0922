/**
 * 人工上报随附照片的写入测试（V1-B.1 收口）。
 *
 * 口径：人工上报**只有一个受控入口** `reportManualIssue()` —— 问题、附件、时间线、审计日志
 * 在同一个 IndexedDB 事务里提交，不再"先建问题 → 照片逐张入库 → 再关联"。
 * 任一环节失败就整体回滚；同一提交重试按提交标识复用问题、按草稿标识复用附件（不重复新增）；
 * 重试时若带了新照片，要补进问题并留下"补充照片"时间线。
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
function draft(id: string): DraftPhotoInput {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3])
  return {
    id,
    fileName: `${id}.jpg`,
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    thumb: new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' }),
    size: bytes.length,
    width: 640,
    height: 480,
    capturedAt: AT,
  }
}

async function setup(): Promise<void> {
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
  session.role = 'safety'
}

/** 人工上报（同一测点、同一异常类型 → 同一次提交标识，10 分钟窗口内复用同一条问题） */
function report(photoDrafts: DraftPhotoInput[] = [], description = '一层走廊发现探头支架松动') {
  const issues = useIssueStore()
  return issues.reportManualIssue({
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    anomalyType: '探头松动',
    description,
    photos: [],
    photoDrafts,
    detail: description,
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('人工上报的照片随问题同事务提交', () => {
  it('带照片上报：问题、附件、时间线、日志一次成立', async () => {
    await setup()
    const out = await report([draft('d1'), draft('d2')])

    const issue = await db.issues.get(out.issue.id)
    expect(issue?.photos).toEqual([attachmentIdOf('d1'), attachmentIdOf('d2')])
    expect(issue?.photos).not.toContain(attachmentIdOf('d'))

    const rows = await db.attachments.toArray()
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.issueId === out.issue.id)).toBe(true)
    expect(rows.every((row) => row.blob instanceof Blob)).toBe(true)

    // 审计日志里的照片张数取的是最终行，而不是提交前的空数组
    const logs = await db.audits.toArray()
    expect(logs.at(-1)?.reason).toContain('照片 2 张')
  })

  it('附件写库失败时问题不落地（不留"问题已建、照片没挂上"）', async () => {
    await setup()
    const original = db.attachments.bulkPut.bind(db.attachments)
    ;(db.attachments as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟附件写入失败')
    }
    let failed = false
    try {
      await report([draft('d1')])
    } catch {
      failed = true
    } finally {
      ;(db.attachments as unknown as { bulkPut: unknown }).bulkPut = original
    }

    expect(failed).toBe(true)
    expect(await db.issues.count()).toBe(0)
    expect(await db.attachments.count()).toBe(0)
    expect(await db.audits.count()).toBe(0)

    // 恢复后重试：问题与照片一起成立
    const retry = await report([draft('d1')])
    expect(retry.issue.photos).toEqual([attachmentIdOf('d1')])
    expect(await db.attachments.count()).toBe(1)
  })

  it('问题写库失败时附件也不落地', async () => {
    await setup()
    const original = db.issues.add.bind(db.issues)
    ;(db.issues as unknown as { add: unknown }).add = () => {
      throw new Error('模拟问题写入失败')
    }
    let failed = false
    try {
      await report([draft('d1')])
    } catch {
      failed = true
    } finally {
      ;(db.issues as unknown as { add: unknown }).add = original
    }

    expect(failed).toBe(true)
    expect(await db.attachments.count()).toBe(0)
    expect(await db.audits.count()).toBe(0)
  })

  it('同一草稿重复提交：问题复用、附件不重复新增、照片不重复记', async () => {
    await setup()
    const first = await report([draft('d1'), draft('d2')])
    const again = await report([draft('d1'), draft('d2')])

    expect(again.duplicated).toBe(true)
    expect(again.issue.id).toBe(first.issue.id)
    expect(await db.issues.count()).toBe(1)
    expect(await db.attachments.count()).toBe(2)
    expect((await db.issues.get(first.issue.id))?.photos).toHaveLength(2)
    // 没有新增照片就不该出现"补充照片"时间线
    const issue = await db.issues.get(first.issue.id)
    expect(issue?.timeline.filter((row) => row.action === '补充照片')).toHaveLength(0)
  })

  it('重复上报时带了新照片：补进问题并留下"补充照片"时间线', async () => {
    await setup()
    const first = await report([draft('d1')])
    const second = await report([draft('d1'), draft('d3')])

    expect(second.duplicated).toBe(true)
    expect(second.issue.id).toBe(first.issue.id)
    expect(await db.attachments.count()).toBe(2)
    const issue = await db.issues.get(first.issue.id)
    expect(issue?.photos).toEqual([attachmentIdOf('d1'), attachmentIdOf('d3')])

    const supplemented = issue?.timeline.filter((row) => row.action === '补充照片') ?? []
    expect(supplemented).toHaveLength(1)
    expect(supplemented[0].detail).toContain('1 张')
  })

  it('不带照片上报仍然正常（照片是选填项）', async () => {
    await setup()
    const out = await report([])
    expect(out.issue.photos).toEqual([])
    expect(await db.attachments.count()).toBe(0)
    expect((await db.audits.toArray()).at(-1)?.reason).toContain('照片 0 张')
  })
})
