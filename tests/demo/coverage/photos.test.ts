import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/database'
import { readDataset } from '@/db/repo'
import { scanIntegrity } from '@/core/integrity'
import { freshSeed, reloadAll } from '../harness'
import { loadCoverageScenario } from '@/stores/writes/demo/coverage'
import { CLOSED_CRACK } from '@/stores/writes/demo/coverage/archive'

// 只替换 Node 不具备的画布生成/压缩；附件落库、归属和业务事务仍走原实现。
vi.mock('@/stores/writes/demo/support', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/writes/demo/support')>()
  return { ...actual, makeDemoPhoto: async (name: string) => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X0AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))
    return new File([bytes], `${name}.png`, { type: 'image/png' })
  } }
})

describe('新历史案例照片归属与重复载入', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T10:00:00+08:00'))
    vi.stubGlobal('createImageBitmap', async () => ({ width: 1, height: 1, close: () => undefined }))
    vi.stubGlobal('document', { createElement: () => ({
      width: 1, height: 1, getContext: () => ({ drawImage: () => undefined }),
      toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array([255, 216, 255, 217])], { type: 'image/jpeg' })),
    }) })
    await freshSeed(); await reloadAll()
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('工单两张完工/一张验收及巡检现场照片正确入库，重载不复制', async () => {
    await loadCoverageScenario()
    const event = await db.events.where('pointId').equals(CLOSED_CRACK).first()
    const issue = await db.issues.where('eventId').equals(event?.id ?? '').first()
    const orderPhotos = await db.attachments.where('workOrderId').equals(issue?.workOrderIds[0] ?? '').toArray()
    expect(orderPhotos.map((row) => row.kind).sort()).toEqual(['acceptance', 'after', 'after'])
    const inspectionIssue = await db.issues.filter((row) => row.source === 'inspection').first()
    const scene = await db.attachments.where('issueId').equals(inspectionIssue?.id ?? '').toArray()
    expect(scene.map((row) => row.kind)).toEqual(['scene'])
    const photos = await db.attachments.toArray()
    expect(photos).toHaveLength(4)
    expect(photos.every((row) => [row.issueId, row.workOrderId, row.maintenanceTaskId].filter(Boolean).length === 1 && row.blob.size > 0)).toBe(true)
    expect(scanIntegrity(await readDataset()).filter((row) => row.level === 'error')).toEqual([])
    await loadCoverageScenario()
    expect((await db.attachments.toArray()).map((row) => [row.id, row.kind, row.size])).toEqual(photos.map((row) => [row.id, row.kind, row.size]))
  })
})
