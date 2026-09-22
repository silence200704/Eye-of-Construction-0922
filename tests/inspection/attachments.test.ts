/**
 * 照片附件测试。
 * 压缩本身依赖 canvas，在单元测试里不跑；这里锁住"张数与体积上限"的判定口径，
 * 以及**照片 Blob 的写库往返** —— 后者曾经整条链路是坏的（见下方回归说明）。
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { attachmentBudget, formatBytes, totalPhotoBytes } from '@/db/inspection/attachments'
import { db } from '@/db/database'
import { putAttachment } from '@/db/repo'
import { toPlain } from '@/core/plain'
import type { IssueAttachment } from '@/types/inspection'

const LIMITS = { count: 3, totalBytes: 600 * 1024 }
const AT = '2026-09-21T09:00:00.000Z'

/** 造一张最小 JPEG（不依赖 canvas，也不依赖真实图片文件）。 */
function jpegBytes(length = 300): Uint8Array {
  const bytes = new Uint8Array(length)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[length - 2] = 0xff
  bytes[length - 1] = 0xd9
  for (let i = 2; i < length - 2; i += 1) bytes[i] = i % 251
  return bytes
}

function attachment(override: Partial<IssueAttachment> = {}): IssueAttachment {
  const bytes = jpegBytes()
  return {
    id: 'att_1',
    issueId: 'iss_1',
    workOrderId: null,
    kind: 'scene',
    draftId: 'draft_1',
    fileName: '现场照片.jpg',
    mimeType: 'image/jpeg',
    size: bytes.length,
    width: 640,
    height: 480,
    uploadedAt: AT,
    uploadedBy: '巡检人员',
    capturedAt: AT,
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    thumb: new Blob([jpegBytes(120)], { type: 'image/jpeg' }),
    ...override,
  }
}

/**
 * 回归：`toPlain` 曾用 `JSON.parse(JSON.stringify())` 深拷贝，而 JSON 会把 Blob 变成 `{}`。
 * 照片一入库 blob/thumb 就没了 —— 详情页对它调 createObjectURL 抛 TypeError（详情区整块渲染不出来）、
 * 备份导出调 arrayBuffer() 抛错。当时测试全绿，是因为没有一条用例走过"写库"这一步。
 */
describe('照片 Blob 的写库往返', () => {
  it('toPlain 保留 Blob，同时仍然把响应式代理解包成可写库的纯数据', () => {
    const plain = toPlain(reactive({ id: 'att_1', blob: attachment().blob, nested: { size: 4 } }))
    expect(plain.blob).toBeInstanceOf(Blob)
    expect(plain.blob.size).toBe(300)
    expect(plain.nested.size).toBe(4)
    // 响应式代理直接进 IndexedDB 会抛 DataCloneError；解包后必须能克隆
    expect(() => structuredClone(plain)).not.toThrow()
    expect(() => structuredClone(reactive({ a: 1 }))).toThrow()
  })

  it('照片写库再读回，blob 与 thumb 仍是 Blob 且字节一致', async () => {
    await db.delete()
    await db.open()
    const row = attachment()
    await putAttachment(row)

    const stored = await db.attachments.get('att_1')
    expect(stored?.blob).toBeInstanceOf(Blob)
    expect(stored?.thumb).toBeInstanceOf(Blob)
    expect(stored?.blob.size).toBe(row.size)
    const bytes = new Uint8Array(await stored?.blob.arrayBuffer())
    expect(bytes.length).toBe(row.size)
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
  })

  it('备份导出能读到写库后的照片字节（不再抛 arrayBuffer 错误）', async () => {
    await db.delete()
    await db.open()
    await putAttachment(attachment())
    const stored = await db.attachments.toArray()
    await expect(stored[0].blob.arrayBuffer()).resolves.toBeInstanceOf(ArrayBuffer)
  })
})

describe('照片张数与体积上限', () => {
  it('空列表可以传满三张', () => {
    const budget = attachmentBudget([], 200 * 1024, LIMITS)
    expect(budget.ok).toBe(true)
    expect(budget.remaining).toBe(3)
  })

  it('超过张数上限时拒绝并说明', () => {
    const rows = [{ size: 100 * 1024 }, { size: 100 * 1024 }, { size: 100 * 1024 }]
    const budget = attachmentBudget(rows, 50 * 1024, LIMITS)
    expect(budget.ok).toBe(false)
    expect(budget.reason).toContain('最多上传 3 张')
    expect(budget.remaining).toBe(0)
  })

  it('总量超过 600 KB 时拒绝，并把已有的与本次的都报出来', () => {
    const rows = [{ size: 300 * 1024 }, { size: 250 * 1024 }]
    const budget = attachmentBudget(rows, 100 * 1024, LIMITS)
    expect(budget.ok).toBe(false)
    expect(budget.reason).toContain('不能超过 600 KB')
    expect(budget.reason).toContain('已有 550 KB')
  })

  it('恰好等于上限仍然允许', () => {
    const rows = [{ size: 200 * 1024 }, { size: 200 * 1024 }]
    expect(attachmentBudget(rows, 200 * 1024, LIMITS).ok).toBe(true)
  })

  it('已占用字节数按全部附件累加', () => {
    expect(totalPhotoBytes([{ size: 1 }, { size: 2 }])).toBe(3)
  })
})

describe('体积显示', () => {
  it('按量级给出可读单位，便于页面提示', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(200 * 1024)).toBe('200 KB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})
