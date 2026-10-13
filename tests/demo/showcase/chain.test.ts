import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/database'
import { freshSeed, reloadAll } from '../harness'
import { mainSteps, type ShowcaseRefs } from '@/stores/demo/showcase/mainChain'
import { useSessionStore } from '@/stores/session'
import { prepareClosedHistory } from '@/stores/writes/demo/coverage/history'
import { prepareExtraArchive, CLOSED_CRACK } from '@/stores/writes/demo/coverage/archive'
import { prepareCompletedInspection } from '@/stores/writes/demo/coverage/inspection'
import { useIssueStore } from '@/stores/inspection/issues'
import { useTaskStore } from '@/stores/inspection/tasks'
import { flushReceipts, receipts } from '@/core/operations/receipts'

vi.mock('@/stores/writes/demo/support', async (original) => {
  const actual = await original<typeof import('@/stores/writes/demo/support')>()
  return { ...actual, makeDemoPhoto: async (name: string) => new File([
    Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X0AAAAASUVORK5CYII='), c => c.charCodeAt(0)),
  ], `${name}.png`, { type: 'image/png' }) }
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T10:00:00+08:00'))
  vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close: () => {} }))
  vi.stubGlobal('document', { createElement: () => ({ width: 1, height: 1,
    getContext: () => ({ drawImage: () => {} }),
    toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([255,216,255,217])], { type: 'image/jpeg' })),
  }) })
  await freshSeed()
  await reloadAll()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('自动主案例使用原事务完成闭环', () => {
  it('无需手动表单，产生升级、照片、验收、复查和关闭依据；重试不复制', async () => {
    const refs: ShowcaseRefs = { eventId: '', issueId: '', orderId: '' }
    const steps = mainSteps(refs)
    for (const step of steps) await step.run()
    const event = await db.events.get(refs.eventId)
    const issue = await db.issues.get(refs.issueId)
    const order = await db.workOrders.get(refs.orderId)
    expect(event?.upgrades).toHaveLength(2)
    expect(event?.status).toBe('closed')
    expect(event?.closeBasis).not.toBe('')
    expect(issue?.status).toBe('closed')
    expect(issue?.rechecks[0]?.outcome).toBe('recovered')
    expect(order?.status).toBe('verified')
    await flushReceipts()
    expect(receipts.value.some(r => r.id === refs.orderId && r.after === '验收通过' && r.attachmentCount === 3)).toBe(true)
    expect((await db.attachments.where('workOrderId').equals(refs.orderId).toArray()).map(r => r.kind).sort())
      .toEqual(['acceptance', 'after', 'after'])
    const counts = await Promise.all([db.records.count(), db.events.count(), db.issues.count(), db.workOrders.count(), db.attachments.count()])
    for (const step of steps) await step.run()
    expect(await Promise.all([db.records.count(), db.events.count(), db.issues.count(), db.workOrders.count(), db.attachments.count()])).toEqual(counts)
    expect(useSessionStore().name).toBe('演示操作员')
  })
  it('历史准备中断后按已保存状态继续，不重复采样或建工单', async () => {
    await prepareExtraArchive()
    vi.spyOn(useIssueStore(),'reviewIssue').mockRejectedValueOnce(new Error('模拟审核中断'))
    await expect(prepareClosedHistory({ resume: true })).rejects.toThrow('模拟审核中断')
    const count = await db.records.where('pointId').equals(CLOSED_CRACK).count()
    const id = await prepareClosedHistory({ resume: true })
    expect((await db.events.get(id))?.status).toBe('closed')
    expect(await db.records.where('pointId').equals(CLOSED_CRACK).count()).toBe(count)
    expect(await db.workOrders.where('eventId').equals(id).count()).toBe(1)
  })
  it('巡检中断后保留已完成点与到点尝试，继续异常提交', async () => {
    vi.spyOn(useTaskStore(),'reportInspectionIssue').mockRejectedValueOnce(new Error('模拟上报中断'))
    await expect(prepareCompletedInspection({ resume: true })).rejects.toThrow('模拟上报中断')
    const prior = (await db.tasks.toArray())[0]!
    const attempts = prior.results.map(r => r.attempts.length)
    const id = await prepareCompletedInspection({ resume: true })
    const task = await db.tasks.get(id)
    expect(task?.status).toBe('checked')
    expect(task?.results.map(r => r.attempts.length)).toEqual(attempts)
    expect(task?.issueIds).toHaveLength(1)
  })
})
