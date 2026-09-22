/**
 * 照片备份往返测试。
 * 走的是真实链路：Blob → base64 data URL → JSON 备份文本 → 解析 → 还原 Blob。
 * 验收图片字节、MIME、文件名、关联问题/工单编号都不丢。
 */
import { describe, expect, it } from 'vitest'
import { buildBackup, parseBackup, toDataset } from '@/db/backup'
import type { Dataset } from '@/db/repo'
import type { IssueAttachment } from '@/types/inspection'

const AT = '2026-09-20T09:00:00.000Z'

/** 造一个最小的 JPEG 字节序列（不依赖真实图片文件） */
function jpegBytes(length = 300): Uint8Array {
  const bytes = new Uint8Array(length)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[length - 2] = 0xff
  bytes[length - 1] = 0xd9
  for (let index = 2; index < length - 2; index += 1) bytes[index] = index % 251
  return bytes
}

function attachment(override: Partial<IssueAttachment> = {}): IssueAttachment {
  const bytes = jpegBytes()
  return {
    id: 'att_1',
    issueId: 'iss_1',
    workOrderId: null,
    kind: 'scene',
    fileName: '现场照片-探头松动.jpg',
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

/** 只有附件有用的最小数据集，其余表给空数组 */
function datasetWith(attachments: IssueAttachment[]): Dataset {
  return {
    buildings: [],
    floors: [],
    points: [],
    devices: [],
    baselines: [],
    records: [],
    audits: [],
    rules: [],
    events: [],
    notifications: [],
    plans: [],
    tasks: [],
    issues: [],
    workOrders: [],
    attachments,
  }
}

describe('照片随备份往返', () => {
  it('照片字节、MIME、文件名、关联编号往返后完全一致', async () => {
    const before = attachment()
    const pkg = await buildBackup(datasetWith([before]), '演示操作员')

    // 走真实的 JSON 文本（备份文件就是这么落盘的）
    const text = JSON.stringify(pkg)
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    const restored = toDataset(parsed.data!).attachments
    expect(restored).toHaveLength(1)

    const after = restored[0]
    expect(after.fileName).toBe('现场照片-探头松动.jpg')
    expect(after.mimeType).toBe('image/jpeg')
    expect(after.issueId).toBe('iss_1')
    expect(after.workOrderId).toBeNull()
    expect(after.kind).toBe('scene')
    expect(after.uploadedBy).toBe('巡检人员')
    expect(after.capturedAt).toBe(AT)
    expect(after.size).toBe(before.size)
    expect(after.width).toBe(640)
    expect(after.height).toBe(480)

    // 关键：字节内容一致，不是"看起来有张图"
    const original = new Uint8Array(await before.blob.arrayBuffer())
    const roundTrip = new Uint8Array(await after.blob.arrayBuffer())
    expect(roundTrip.length).toBe(original.length)
    expect([...roundTrip]).toEqual([...original])
    expect(after.thumb.size).toBe(before.thumb.size)
  })

  it('关联到工单的照片同样保留关联编号与用途', async () => {
    const row = attachment({ id: 'att_2', issueId: null, workOrderId: 'wo_1', kind: 'after' })
    const pkg = await buildBackup(datasetWith([row]), '维修人员')
    const restored = toDataset(parseBackup(JSON.stringify(pkg)).data!).attachments[0]
    expect(restored.workOrderId).toBe('wo_1')
    expect(restored.issueId).toBeNull()
    expect(restored.kind).toBe('after')
  })

  it('没有照片时备份里是空数组，体积估算为 0 张', async () => {
    const pkg = await buildBackup(datasetWith([]), '演示操作员')
    expect(pkg.data.attachments).toEqual([])
    const restored = toDataset(parseBackup(JSON.stringify(pkg)).data!).attachments
    expect(restored).toEqual([])
  })

  it('结构损坏的附件条目被丢弃，不让坏数据进库', () => {
    const broken = {
      format: 'zhutong-demo-backup',
      appVersion: 'V0.3',
      schemaVersion: 4,
      exportedAt: AT,
      exportedBy: '测试',
      counts: {},
      data: {
        buildings: [],
        floors: [],
        points: [],
        devices: [],
        baselines: [],
        records: [],
        audits: [],
        attachments: [{ id: 'att_bad', fileName: '缺图.jpg' }, { id: 42, blob: 'x' }],
      },
    }
    const parsed = parseBackup(JSON.stringify(broken))
    expect(parsed.ok).toBe(true)
    expect(toDataset(parsed.data!).attachments).toEqual([])
  })

  /**
   * 回归：库里已有的损坏附件（早期版本用 JSON 深拷贝写库，照片只剩 `{}`）不能让导出整个失败。
   * 这类行救不回来，但必须跳过它、如实报出条数，其余数据照常导出。
   */
  it('库里的损坏照片被跳过，不中断导出，并报出损坏条数', async () => {
    const good = attachment({ id: 'att_ok' })
    const corrupted = { ...attachment({ id: 'att_bad' }), blob: {}, thumb: {} } as unknown as IssueAttachment
    const pkg = await buildBackup(datasetWith([good, corrupted]), '演示操作员')

    expect(pkg.brokenPhotos).toBe(1)
    expect(pkg.data.attachments).toHaveLength(1)
    expect(pkg.data.attachments?.[0].id).toBe('att_ok')
    // 导出的文本仍然可解析、可还原，好照片字节不丢
    const parsed = parseBackup(JSON.stringify(pkg))
    expect(parsed.ok).toBe(true)
    const restored = toDataset(parsed.data!).attachments
    expect(restored).toHaveLength(1)
    expect(restored[0].blob.size).toBe(good.blob.size)
  })

  it('全部照片都完好时损坏条数为 0', async () => {
    const pkg = await buildBackup(datasetWith([attachment()]), '演示操作员')
    expect(pkg.brokenPhotos).toBe(0)
  })
})
