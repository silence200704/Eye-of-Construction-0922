import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/database'
import { freshSeed, reloadAll } from '../harness'
import { mainSteps, type ShowcaseRefs } from '@/stores/demo/showcase/mainChain'
import { useSessionStore } from '@/stores/session'

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
    expect((await db.attachments.where('workOrderId').equals(refs.orderId).toArray()).map(r => r.kind).sort())
      .toEqual(['acceptance', 'after', 'after'])
    const counts = await Promise.all([db.records.count(), db.events.count(), db.issues.count(), db.workOrders.count(), db.attachments.count()])
    for (const step of steps) await step.run()
    expect(await Promise.all([db.records.count(), db.events.count(), db.issues.count(), db.workOrders.count(), db.attachments.count()])).toEqual(counts)
    expect(useSessionStore().name).toBe('演示操作员')
  })
})
