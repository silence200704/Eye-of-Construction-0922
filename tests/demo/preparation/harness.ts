import { vi } from 'vitest'
import { db } from '@/db/database'
import { freshSeed, reloadAll } from '../harness'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import { useClockStore } from '@/stores/clock'
import { useMediaStore } from '@/stores/media'
import { makeRecord } from '../../fixtures'
import { P_CRACK, D_CRACK } from '@/db/seedFactories'
import type { FrameOrigin } from '@/types/media'

export const NOW = '2026-10-01T04:00:00.000Z'
export async function setup(): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  await freshSeed()
  await db.records.clear()
  await reloadAll()
  await usePlanStore().reload()
  await useTaskStore().reload()
  useClockStore().nowKey = NOW
}
export function authorize(): void {
  usePreparationSession().start(['sampling', 'media', 'inspection'])
}
export async function sample(overrides: Parameters<typeof makeRecord>[0] = {}): Promise<void> {
  await db.records.put(makeRecord({ pointId: P_CRACK, deviceId: D_CRACK, sampleTime: NOW, enteredAt: NOW, source: 'device', ...overrides }))
}
export function frames(origin: FrameOrigin = 'upload', count = 2): void {
  useMediaStore().frames = Array.from({ length: count }, (_, i) => ({
    id: `frame_${i}`, pointId: P_CRACK, origin, label: '测试墙面', fileName: `test_${i}.jpg`,
    capturedAt: new Date(Date.parse(NOW) + i).toISOString(), width: 2, height: 2, size: 1,
    blob: new Blob(['x'], { type: 'image/jpeg' }), timeCode: null,
  }))
}
export async function tables(): Promise<string> {
  return JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())))
}
