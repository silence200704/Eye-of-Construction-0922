/**
 * 工单守卫测试：并发建单不撞号、验收权限落在仓储、验收写入的事务原子性。
 *
 * 这三条都是"页面上看不出来、但会把数据写坏"的问题：
 * 撞号会让两张工单同名；验收权限只靠页面隐藏，换个入口就能绕过；
 * 验收与问题状态分两次写，会出现"工单已验收、问题还在处理中"的半成品。
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { act, reportIssue, seedWorld, setupRepairOrder } from './harness'

/** 把工单推进到"待验收"：派工 → 接单 → 提交完工。 */
async function toSubmitted(orderId: string): Promise<void> {
  const orders = useWorkOrderStore()
  act('safety')
  await orders.advanceOrder(orderId, 'assigned', { assignee: '维修人员' })
  act('repair')
  await orders.advanceOrder(orderId, 'repairing', {})
  await orders.advanceOrder(orderId, 'submitted', { measures: '已加固' })
}

describe('并发转维修不撞号', () => {
  it('三个问题同时转维修，生成三张编号互不相同的工单', async () => {
    await seedWorld('safety')
    const issues = useIssueStore()
    const ids = [await reportIssue('探头松动'), await reportIssue('裂缝扩展'), await reportIssue('渗水受潮')]

    const out = await Promise.all(
      ids.map((id, index) =>
        issues.reviewIssue(id, {
          action: 'to_repair',
          category: 'equipment',
          note: `现场确认属于设备故障，转维修处理（第 ${index + 1} 张）`,
        }),
      ),
    )
    expect(out.every((row) => row.ok)).toBe(true)

    const orders = await db.workOrders.toArray()
    expect(orders).toHaveLength(3)
    const nos = orders.map((row) => row.orderNo).sort()
    expect(new Set(nos).size).toBe(3)
    expect(nos).toEqual([
      expect.stringMatching(/-001$/),
      expect.stringMatching(/-002$/),
      expect.stringMatching(/-003$/),
    ])
  })
})

describe('验收权限由仓储强制', () => {
  it('物业、巡检、维修、验收人员直接调用仓储都不能验收通过或退回，数据不变化', async () => {
    const { orderId, issueId } = await setupRepairOrder()
    await toSubmitted(orderId)
    const orders = useWorkOrderStore()

    const orderBefore = JSON.stringify(await db.workOrders.get(orderId))
    const issueBefore = JSON.stringify(await db.issues.get(issueId))
    const logsBefore = await db.audits.count()

    for (const role of ['property', 'inspector', 'repair', 'reviewer']) {
      act(role)
      const verify = await orders.advanceOrder(orderId, 'verified', { note: '同意验收' })
      expect(verify.ok).toBe(false)
      expect(verify.error).toContain('学校安全管理人员')

      const returned = await orders.advanceOrder(orderId, 'returned', { note: '不合格' })
      expect(returned.ok).toBe(false)
      expect(returned.error).toContain('学校安全管理人员')
    }

    expect(JSON.stringify(await db.workOrders.get(orderId))).toBe(orderBefore)
    expect(JSON.stringify(await db.issues.get(issueId))).toBe(issueBefore)
    expect(await db.audits.count()).toBe(logsBefore)
  })

  it('安全管理人员验收成功，工单与问题同时推进', async () => {
    const { orderId, issueId } = await setupRepairOrder()
    await toSubmitted(orderId)
    const orders = useWorkOrderStore()

    act('safety')
    const out = await orders.advanceOrder(orderId, 'verified', { note: '前后照片齐全，通过' })
    expect(out.ok).toBe(true)
    expect((await db.workOrders.get(orderId))?.status).toBe('verified')
    expect((await db.issues.get(issueId))?.status).toBe('pending_recheck')
  })
})

describe('验收写入的事务原子性', () => {
  it('问题写入失败时工单也不落库，不出现"已验收但问题还在处理中"', async () => {
    const { orderId, issueId } = await setupRepairOrder()
    await toSubmitted(orderId)
    const orders = useWorkOrderStore()
    act('safety')

    // 人为让事务内的问题写入失败
    const original = db.issues.put.bind(db.issues)
    ;(db.issues as unknown as { put: unknown }).put = () => {
      throw new Error('模拟问题写入失败')
    }
    let failed = false
    try {
      await orders.advanceOrder(orderId, 'verified', { note: '前后照片齐全，通过' })
    } catch {
      failed = true
    } finally {
      ;(db.issues as unknown as { put: unknown }).put = original
    }
    expect(failed).toBe(true)

    const order = await db.workOrders.get(orderId)
    expect(order?.status).toBe('submitted')
    expect(order?.reviews).toHaveLength(0)
    expect((await db.issues.get(issueId))?.status).toBe('repairing')

    // 恢复后重试：工单与问题一起成立
    const retry = await orders.advanceOrder(orderId, 'verified', { note: '前后照片齐全，通过' })
    expect(retry.ok).toBe(true)
    expect((await db.workOrders.get(orderId))?.status).toBe('verified')
    expect((await db.issues.get(issueId))?.status).toBe('pending_recheck')
  })

  it('关联问题不存在时验收被拒，工单保持待验收（不留半成品）', async () => {
    const { orderId, issueId } = await setupRepairOrder()
    await toSubmitted(orderId)
    const orders = useWorkOrderStore()
    act('safety')

    await db.issues.delete(issueId)
    const out = await orders.advanceOrder(orderId, 'verified', { note: '前后照片齐全，通过' })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('关联问题不存在')
    expect((await db.workOrders.get(orderId))?.status).toBe('submitted')
  })
})
