/**
 * 工单闭环测试：审核转维修原子建单 → 派工 → 接单 → 完工 → 验收。
 *
 * 重点钉住五件事：
 * ① 提交待验收时**措施是这一次才填的**，判定必须基于"并入提交内容后的候选状态"，
 *    否则永远报"必须填写维修措施"（这是实测中真实出现过的缺陷）；
 * ② 验收通过只把问题推进到"待复查"，不自动关闭；
 * ③ 验收通过时问题状态**随工单同一个事务**写入，链路上不再有第二次写问题状态的调用；
 * ④ 完工照片重试只补关联、不重复上传；
 * ⑤ 派给谁就由谁接单，物业值班代接必须写原因。
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { planPhotoSync } from '@/db/inspection/attachments'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { act, seedWorld, setupRepairOrder } from './harness'

const AT = '2026-09-21T09:00:00.000Z'

describe('工单闭环', () => {
  it('审核转维修自动生成待派工工单，单号与来源正确', async () => {
    const { issueId } = await setupRepairOrder()
    const orders = await db.workOrders.toArray()
    expect(orders[0].status).toBe('created')
    expect(orders[0].orderNo).toMatch(/^WO-\d{8}-\d{3}$/)
    expect(orders[0].origin).toBe('issue')
    const issue = await db.issues.get(issueId)
    expect(issue?.status).toBe('repairing')
    expect(issue?.workOrderIds).toEqual([orders[0].id])
  })

  it('只有安全管理人员能派工，且必须指定维修人', async () => {
    const { orderId } = await setupRepairOrder()
    const orders = useWorkOrderStore()
    act('repair')
    const denied = await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员' })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('派工由学校安全管理人员执行')

    act('safety')
    const noAssignee = await orders.advanceOrder(orderId, 'assigned', { assignee: '' })
    expect(noAssignee.ok).toBe(false)

    const ok = await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员', dueAt: '2026-09-25T00:00:00.000Z' })
    expect(ok.ok).toBe(true)
    expect(ok.order?.status).toBe('assigned')
    expect(ok.order?.assignee).toBe('维修人员')
  })

  it('接单与提交完工限维修侧身份（界面隐藏不算权限）', async () => {
    const { orderId } = await setupRepairOrder()
    const orders = useWorkOrderStore()
    act('safety')
    await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员' })
    const denied = await orders.advanceOrder(orderId, 'repairing', {})
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('维修人员')

    act('repair')
    const ok = await orders.advanceOrder(orderId, 'repairing', { note: '已到场' })
    expect(ok.ok).toBe(true)
  })

  it('派给物业值班人员时，维修人员不能接单（不是被派工人）', async () => {
    const { orderId } = await setupRepairOrder()
    const orders = useWorkOrderStore()
    act('safety')
    await orders.advanceOrder(orderId, 'assigned', { assignee: '物业值班人员' })

    act('repair')
    const wrongPerson = await orders.advanceOrder(orderId, 'repairing', { note: '我先到了' })
    expect(wrongPerson.ok).toBe(false)
    expect(wrongPerson.error).toContain('已派给「物业值班人员」')
  })

  it('派给维修人员时，物业值班可代接但必须写原因，被派工人本人不受限', async () => {
    const { orderId } = await setupRepairOrder()
    const orders = useWorkOrderStore()
    act('safety')
    await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员' })

    act('property')
    const noReason = await orders.advanceOrder(orderId, 'repairing', { note: '  ' })
    expect(noReason.ok).toBe(false)
    expect(noReason.error).toContain('代接')

    const delegated = await orders.advanceOrder(orderId, 'repairing', { note: '原维修人在另一处抢修，本班次由物业值班先行到场' })
    expect(delegated.ok).toBe(true)
    expect(delegated.order?.timeline.at(-1)?.byRole).toBe('物业值班人员')
  })

  it('提交待验收：措施是本次填写的，判定要基于并入后的状态（回归）', async () => {
    const { orderId } = await setupRepairOrder()
    const orders = useWorkOrderStore()
    act('safety')
    await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员' })
    act('repair')
    await orders.advanceOrder(orderId, 'repairing', { note: '已到场' })

    const missing = await orders.advanceOrder(orderId, 'submitted', { measures: '' })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('维修措施')

    const ok = await orders.advanceOrder(orderId, 'submitted', {
      measures: '重新固定支架并更换螺栓',
      materials: 'M6 膨胀螺栓 ×2',
      photos: ['att_1'],
    })
    expect(ok.ok).toBe(true)
    expect(ok.order?.status).toBe('submitted')
    expect(ok.order?.measures).toBe('重新固定支架并更换螺栓')
    expect(ok.order?.photos).toEqual(['att_1'])
    expect(ok.order?.submittedAt).not.toBeNull()
  })

  it('验收退回必须写原因，退回后可继续处理', async () => {
    const { orderId } = await setupRepairOrder()
    const orders = useWorkOrderStore()
    act('safety')
    await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员' })
    act('repair')
    await orders.advanceOrder(orderId, 'repairing', {})
    await orders.advanceOrder(orderId, 'submitted', { measures: '已加固' })

    act('safety')
    const denied = await orders.advanceOrder(orderId, 'returned', { note: '  ' })
    expect(denied.ok).toBe(false)
    const returned = await orders.advanceOrder(orderId, 'returned', { note: '完工照片看不清固定位置' })
    expect(returned.order?.status).toBe('returned')
    expect(returned.order?.reviews.at(-1)?.result).toBe('fail')

    act('repair')
    const again = await orders.advanceOrder(orderId, 'repairing', { note: '重新处理' })
    expect(again.ok).toBe(true)
  })

  it('验收通过：工单与问题同一事务落库，问题只到"待复查"不关闭', async () => {
    const { orderId, issueId } = await setupRepairOrder()
    const orders = useWorkOrderStore()
    act('safety')
    await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员' })
    act('repair')
    await orders.advanceOrder(orderId, 'repairing', {})
    await orders.advanceOrder(orderId, 'submitted', { measures: '已加固' })
    const logsBefore = await db.audits.count()

    act('safety')
    const verified = await orders.advanceOrder(orderId, 'verified', { note: '前后照片齐全，通过' })
    expect(verified.ok).toBe(true)
    expect(verified.order?.status).toBe('verified')

    // 关键：链路里没有第二次调用 —— 问题状态在验收的同一次提交里就已经写好
    const issue = await db.issues.get(issueId)
    expect(issue?.status).toBe('pending_recheck')
    expect(issue?.status).not.toBe('closed')
    expect(issue?.timeline.at(-1)?.action).toBe('进入待复查')

    const logs = (await db.audits.toArray()).slice(logsBefore)
    expect(logs.some((row) => row.summary.includes('验收通过'))).toBe(true)
    expect(logs.some((row) => row.summary.includes('进入待复查'))).toBe(true)
  })

  it('完工照片重试：已入库的草稿只补关联，不重复上传', async () => {
    const { orderId } = await setupRepairOrder()
    const orders = useWorkOrderStore()
    const attachments = useAttachmentStore()
    act('safety')
    await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员' })
    act('repair')
    await orders.advanceOrder(orderId, 'repairing', {})

    // 上一次提交到一半：附件已入库（带工单归属与草稿标识），但工单 photos 还是空
    await db.attachments.put({
      id: 'att_1',
      issueId: null,
      workOrderId: orderId,
      kind: 'after',
      draftId: 'draft_1',
      fileName: '完工.jpg',
      mimeType: 'image/jpeg',
      size: 1024,
      width: 640,
      height: 480,
      uploadedAt: AT,
      uploadedBy: '维修人员',
      capturedAt: null,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      thumb: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
    })
    const order = await db.workOrders.get(orderId)
    expect(order?.photos).toEqual([])

    // 页面据此决定：查库（不是查缓存）→ 只上传缺的那几张
    const existing = await attachments.existingOfOrder(orderId)
    const plan = planPhotoSync([{ id: 'draft_1' }], existing, order?.photos ?? [])
    expect(plan.toUpload).toHaveLength(0)
    expect(plan.toLink.map((row) => row.attachmentId)).toEqual(['att_1'])
    expect(await db.attachments.count()).toBe(1)
  })
})
