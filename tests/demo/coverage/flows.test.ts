import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/database'
import { freshSeed, reloadAll } from '../harness'
import { loadCoverageScenario } from '@/stores/writes/demo/coverage'
import { loadFullChain } from '@/stores/writes/demo/chain'
import { CLOSED_CRACK, NORMAL_TH, QUALITY_TILT, READY_CRACK, STALE_VIB, EXTRA_POINTS } from '@/stores/writes/demo/coverage/archive'
import { buildSnapshot } from '@/assistant/selectors/snapshot'
import { buildStageDurations } from '@/core/chart/dashboard'
import { askZhutong } from '@/assistant'
import { useEventsStore } from '@/stores/events'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useArchiveStore } from '@/stores/archive'
import { useClockStore } from '@/stores/clock'
import { useDemoScenarioStore } from '@/stores/demo/scenarios'
import { readRegistry } from '@/stores/demo/registry'

describe('唯一全链入口的数据全面化', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T10:00:00+08:00'))
    await freshSeed(); await reloadAll()
  })
  afterEach(() => vi.useRealTimers())

  it('原按钮载入后既有待操作红色起点，也有独立已关闭裂缝链；素材仍绑定原点', async () => {
    const result = await useDemoScenarioStore().loadChain()
    expect(result.results.find((row) => row.key === 'coverage')?.ok).toBe(true)
    expect(result.results).toHaveLength(14)
    const pending = await db.events.where('pointId').equals(READY_CRACK).first()
    const closed = await db.events.where('pointId').equals(CLOSED_CRACK).first()
    expect(pending).toMatchObject({ status: 'pending', level: 'red' })
    expect(pending?.evidences.map((row) => row.level)).toEqual(['yellow', 'orange', 'red'])
    expect(await db.issues.where('eventId').equals(pending?.id ?? '').count()).toBe(0)
    expect(closed?.status).toBe('closed')
    expect(closed?.id).not.toBe(pending?.id)
    const issue = await db.issues.where('eventId').equals(closed?.id ?? '').first()
    expect(issue?.status).toBe('closed')
    expect(issue?.rechecks?.[0]?.outcome).toBe('recovered')
    const order = await db.workOrders.get(issue?.workOrderIds[0] ?? '')
    expect(order).toMatchObject({ status: 'verified', issueId: issue?.id, eventId: closed?.id })
    expect(readRegistry().entries.mediaEvidence?.anchors).toEqual([{ kind: 'point', id: 'pnt_b03_f2_crack01' }])
  })

  it('历史案例为阶段图提供真实可计算的非零时间，不改图表公式', async () => {
    expect((await loadCoverageScenario()).ok).toBe(true)
    const snapshot = buildSnapshot()
    const model = buildStageDurations(snapshot, [CLOSED_CRACK])
    expect(model.inconsistent).toBe(0)
    expect(model.stages.map((row) => row.hours)).toEqual([50, 8, 2])
    const event = snapshot.events.find((row) => row.pointId === CLOSED_CRACK)
    expect(event?.note).toContain('预设测试值')
    const rows = await db.records.where('pointId').equals(CLOSED_CRACK).toArray()
    expect(rows.every((row) => Date.parse(row.enteredAt) >= Date.parse(row.sampleTime))).toBe(true)
    expect(event?.evidences.every((row) => Date.parse(row.addedAt) >= Date.parse(row.sampleTime))).toBe(true)
  })

  it('已完成巡检保留正常检查、错码拒绝、异常和真实巡检来源问题；今日任务仍可继续', async () => {
    const result = await loadFullChain()
    expect(result.results.filter((row) => !row.ok)).toEqual([])
    const tasks = useTaskStore()
    const completed = tasks.tasks.find((row) => row.planSnapshot.planName === '演示场景：已完成巡检与异常上报')
    expect(completed?.status).toBe('checked')
    expect(completed?.results.every((row) => row.status === 'completed')).toBe(true)
    const abnormal = completed?.results.find((row) => row.pointId === 'pnt_b03_f2_tilt01')
    expect(abnormal?.attempts.map((row) => row.passed)).toEqual([false, true])
    const issue = await db.issues.get(abnormal?.abnormalHandling.linkedIssueId ?? '')
    expect(issue).toMatchObject({ source: 'inspection', taskId: completed?.id, pointId: abnormal?.pointId })
    const current = tasks.tasks.find((row) => row.planSnapshot.planName.includes('二层日常巡检'))
    expect(current?.results.filter((row) => row.status === 'pending')).toHaveLength(3)
    expect(await db.workOrders.filter((row) => row.status === 'assigned').count()).toBe(1)
  })

  it('新增档案覆盖不同楼栋与楼层，2D/3D读取同一归一化坐标，不改变人工检查点', async () => {
    await loadCoverageScenario()
    const archive = useArchiveStore()
    expect(archive.activePoints).toHaveLength(14)
    expect(archive.activePoints.filter((row) => row.metric === 'inspection')).toHaveLength(5)
    for (const spec of EXTRA_POINTS) {
      const point = archive.pointById(spec.id)
      expect(point).toMatchObject({ buildingId: spec.buildingId, floorId: spec.floorId, coord: { x: spec.x, y: spec.y } })
      const rule = archive.ruleFor(spec.id, new Date().toISOString())
      expect(rule?.pointIds).toEqual([spec.id])
      expect(archive.devicesOfPoint(spec.id)).toHaveLength(1)
    }
    expect(archive.pointsOfBuilding('bld_b01').some((row) => row.id === NORMAL_TH)).toBe(true)
  })

  it('存疑/无效的大数不产生误报，旧采样不宣称设备离线，小瞳普通提问零写库', async () => {
    await loadCoverageScenario()
    useClockStore().refresh()
    expect((await db.records.where('pointId').equals(QUALITY_TILT).toArray()).map((row) => row.quality).sort()).toEqual(['invalid', 'suspect', 'valid', 'valid', 'valid', 'valid'])
    expect(await db.events.where('pointId').equals(QUALITY_TILT).count()).toBe(0)
    const stale = await db.records.where('pointId').equals(STALE_VIB).toArray()
    expect(stale.every((row) => Date.now() - Date.parse(row.sampleTime) >= 120 * 60_000)).toBe(true)
    const before = JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())))
    const answer = await askZhutong('B04-F1-VIB01 状态怎么样')
    expect(answer.status).toBe('answered')
    expect(JSON.stringify(await Promise.all(db.tables.map((table) => table.toArray())))).toBe(before)
  })
})
