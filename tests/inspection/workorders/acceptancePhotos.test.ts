/**
 * 验收照片：它必须和验收结论、工单状态、问题待复查状态一起提交。
 *
 * 现场场景：安全管理人员在验收维修成果时补拍照片；若附件失败，不能把工单
 * 写成“已验收”却少了验收证据。照片按 draftId 确定主键，事务重试不得重复。
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import type { DraftPhotoInput } from '@/db/inspection/attachments'
import { act, setupRepairOrder } from './harness'

function draft(id = 'acceptance_1'): DraftPhotoInput {
  return {
    id,
    fileName: '验收现场.jpg',
    blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' }),
    thumb: new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }),
    size: 4,
    width: 640,
    height: 480,
    capturedAt: '2026-09-22T10:00:00.000Z',
  }
}

async function submittedOrder(): Promise<{ orderId: string; issueId: string }> {
  const result = await setupRepairOrder()
  const orders = useWorkOrderStore()
  act('safety')
  await orders.advanceOrder(result.orderId, 'assigned', { assignee: '维修人员' })
  act('repair')
  await orders.advanceOrder(result.orderId, 'repairing', {})
  await orders.advanceOrder(result.orderId, 'submitted', { measures: '重新固定支架并加固螺栓' })
  act('safety')
  return result
}

describe('验收照片与验收结论同事务', () => {
  it('验收通过时写入 acceptance 附件，归属工单且问题同步进入待复查', async () => {
    const { orderId, issueId } = await submittedOrder()
    const orders = useWorkOrderStore()

    const out = await orders.advanceOrder(orderId, 'verified', {
      note: '验收通过，支架稳定且现场复核无松动',
      acceptancePhotos: [draft()],
    })

    expect(out.ok).toBe(true)
    const rows = await db.attachments.where('workOrderId').equals(orderId).toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'att_acceptance_1',
      kind: 'acceptance',
      issueId: null,
      workOrderId: orderId,
      fileName: '验收现场.jpg',
    })
    expect((await db.workOrders.get(orderId))?.status).toBe('verified')
    expect((await db.issues.get(issueId))?.status).toBe('pending_recheck')
  })

  it('验收照片写入失败时，工单、问题与附件整体回滚，恢复后重试只写一张', async () => {
    const { orderId, issueId } = await submittedOrder()
    const orders = useWorkOrderStore()
    const original = db.attachments.bulkPut.bind(db.attachments)
    ;(db.attachments as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟验收照片写入失败')
    }
    await expect(
      orders.advanceOrder(orderId, 'verified', {
        note: '验收通过，支架稳定且现场复核无松动',
        acceptancePhotos: [draft()],
      }),
    ).rejects.toThrow('模拟验收照片写入失败')
    ;(db.attachments as unknown as { bulkPut: unknown }).bulkPut = original

    expect((await db.workOrders.get(orderId))?.status).toBe('submitted')
    expect((await db.issues.get(issueId))?.status).toBe('repairing')
    expect(await db.attachments.count()).toBe(0)

    const retry = await orders.advanceOrder(orderId, 'verified', {
      note: '验收通过，支架稳定且现场复核无松动',
      acceptancePhotos: [draft()],
    })
    expect(retry.ok).toBe(true)
    expect(await db.attachments.count()).toBe(1)
  })
})
