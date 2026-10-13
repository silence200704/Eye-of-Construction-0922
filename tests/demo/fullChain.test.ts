/** 设置页唯一入口：旧数据保护、近期传感器补数与重复点击。 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/database'
import { useClockStore } from '@/stores/clock'
import { useRecordsStore } from '@/stores/records'
import { loadFullChain } from '@/stores/writes/demo/chain'
import { normalizeLegacyDemoSensors } from '@/stores/writes/demo/liveSensors'
import { freshSeed, reloadAll } from './harness'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import { useShowcaseStore } from '@/stores/demo/showcase/session'
import { useSessionStore } from '@/stores/session'
import { useEventsStore } from '@/stores/events'
import { READY_CRACK } from '@/stores/writes/demo/coverage/archive'

describe('演示场景：全链', () => {
  beforeEach(async () => {
    await freshSeed()
    await reloadAll()
  })

  it('旧演示来源只校正未修订的预设行，保留真实手填并留痕', async () => {
    const seed = await db.records.get('rec_seed_01')
    expect(seed).toBeDefined()
    await db.records.update('rec_seed_01', { source: 'manual', enteredBy: '旧版演示操作员' })
    await db.records.update('rec_seed_02', { source: 'manual', revision: 1 })
    await db.records.put({ ...seed!, id: 'rec_user_manual', recordNo: 'R20260915-099', note: '现场手工录入', source: 'manual' })
    const changed = await normalizeLegacyDemoSensors()
    expect(changed).toBe(1)
    expect((await db.records.get('rec_seed_01'))?.source).toBe('device')
    expect((await db.records.get('rec_seed_02'))?.source).toBe('manual')
    expect((await db.records.get('rec_user_manual'))?.source).toBe('manual')
    expect((await db.audits.toArray()).filter((row) => row.objectId === 'demo-sensor-source')).toHaveLength(1)
    expect(await normalizeLegacyDemoSensors()).toBe(0)
  })

  it('全链 14 步全部成功，且第二次载入全部跳过', async () => {
    const first = await loadFullChain()
    expect(first.results.length).toBe(14)
    expect(first.results.filter((row) => !row.ok)).toEqual([])
    expect(first.liveOk).toBe(true)
    expect(first.message).toContain('近期传感器演示采样新增 16 条')

    const now = Date.now()
    const live = useRecordsStore().records.filter((row) => row.note.startsWith('演示模拟实时采样'))
    expect(live).toHaveLength(16)
    expect(new Set(live.map((row) => row.pointId)).size).toBe(4)
    for (const pointId of new Set(live.map((row) => row.pointId))) {
      const samples = live.filter((row) => row.pointId === pointId).sort((a, b) => a.sampleTime.localeCompare(b.sampleTime))
      expect(samples).toHaveLength(4)
      expect(samples.slice(1).every((row, index) => Date.parse(row.sampleTime) - Date.parse(samples[index]!.sampleTime) === 4 * 60_000)).toBe(true)
    }
    expect(Date.parse(useClockStore().nowKey)).toBeGreaterThanOrEqual(Date.parse(live[0]?.sampleTime ?? ''))
    for (const row of live) {
      expect(row.source).toBe('device')
      expect(row.deviceId).not.toBeNull()
      expect(row.isBackfill).toBe(false)
      expect(now - Date.parse(row.sampleTime)).toBeLessThan(13 * 60_000)
    }

    await reloadAll()
    const beforeCount = useRecordsStore().records.length
    const second = await loadFullChain()
    expect(second.results.filter((row) => !row.ok)).toEqual([])
    expect(second.liveOk).toBe(true)
    expect(second.message).toContain('近期传感器演示采样新增 0 条、跳过 4 个测点')
    expect(useRecordsStore().records).toHaveLength(beforeCount)
    expect(second.results.find((row) => row.key === 'records')?.created).toBe(0)
    expect(second.results.find((row) => row.key === 'maintenance')?.created).toBe(0)
  })

  it('手动准备不启动自动演示；待处理案例可人办，重复导入保留确认和身份', async () => {
    const scenarios = useDemoScenarioStore()
    const showcase = useShowcaseStore()
    useSessionStore().setIdentity('手动演示管理员', 'safety')
    const result = await scenarios.loadChain({ autoPrepare: false })
    expect(result.results.every((row) => row.ok)).toBe(true)
    expect(usePreparationSession().active).toBe(false)
    expect(showcase.running).toBe(false)
    expect(showcase.state).toMatchObject({ next: 0, status: 'idle' })
    const event = await db.events.where('pointId').equals(READY_CRACK).first()
    expect(event).toMatchObject({ status: 'pending', level: 'red' })
    expect(await db.issues.where('eventId').equals(event!.id).count()).toBe(0)
    await useEventsStore().acknowledgeEvent(event!.id)
    await scenarios.loadChain({ autoPrepare: false })
    expect((await db.events.get(event!.id))?.status).toBe('handling')
    expect(await db.issues.where('eventId').equals(event!.id).count()).toBe(0)
    expect(useSessionStore().name).toBe('手动演示管理员')
    expect(useSessionStore().role).toBe('safety')
    expect(showcase.state).toMatchObject({ next: 0, status: 'idle' })
  })
})
