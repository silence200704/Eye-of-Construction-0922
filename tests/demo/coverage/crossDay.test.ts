import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/database'
import { freshSeed, reloadAll } from '../harness'
import { loadInspectionScenario } from '@/stores/writes/demo/service'
import { useTaskStore } from '@/stores/inspection/tasks'
import { withActor } from '@/stores/writes/demo/support'

describe('巡检演示按本地当天定位与真实进度计数', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-01T10:00:00+08:00'))
    await freshSeed(); await reloadAll()
  })
  afterEach(() => vi.useRealTimers())

  it('跨天只签到今日任务，锚点不指昨天，昨天任务不变', async () => {
    const yesterday = await loadInspectionScenario()
    const oldId = yesterday.anchorRefs?.[0]?.id ?? ''
    const old = await db.tasks.get(oldId)
    vi.setSystemTime(new Date('2026-10-02T01:30:00+08:00'))
    const today = await loadInspectionScenario()
    expect(today.ok).toBe(true)
    expect(today.anchors[0]).toMatch(/^TK-20261002-/)
    expect(today.anchorRefs?.[0]?.id).not.toBe(oldId)
    const task = await db.tasks.get(today.anchorRefs?.[0]?.id ?? '')
    expect(task?.results.filter((row) => row.status === 'arrived')).toHaveLength(1)
    expect(await db.tasks.get(oldId)).toEqual(old)
  })

  it('人已完成一个点后重复载入，回执按真实结果显示，不固定写一人已到点', async () => {
    const first = await loadInspectionScenario()
    const id = first.anchorRefs?.[0]?.id ?? ''
    const task = useTaskStore().byId(id)
    const answers = task?.planSnapshot.checklist.map((row) => ({ key: row.key, label: row.label, result: 'ok' as const, note: '' })) ?? []
    const done = await withActor('inspector', () => useTaskStore().completePointCheck(id, 'pnt_b03_f2_crack01', { answers, linkedIssueId: null, noIssueReason: '' }))
    expect(done.ok).toBe(true)
    const again = await loadInspectionScenario()
    expect(again.message).toContain('0 个已到点待检查、1 个已完成')
  })
})
