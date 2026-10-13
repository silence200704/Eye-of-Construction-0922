/**
 * 全校概况的只读计数。
 *
 * 每个数字都能在界面上找到同源的去处（在册楼栋/测点、传感器与人工检查点、未关闭事件队列），
 * 因此问答里的数字与看板、事件队列不会对不上。
 * 计数一律按**事件 ID 去重**：事件表本身一条事件一行，升级只改这一行、不新增，天然不重复计。
 */
import { hasNumericReadings } from '@/types/catalog'
import type { EventLevel } from '@/types/events'
import type { RecordSource } from '@/types/domain'
import { emptyLevelCount, sortedNewestFirst } from './shared'
import type { AssistantSnapshot } from './snapshot'
import { freshnessOf, latestValidRecord, recordsOfPoint } from './records'

export interface OverviewCounts {
  activeBuildings: number
  activePoints: number
  /** 在册且会产生数值记录的测点（即"在册绑定传感器的测点"） */
  sensorPoints: number
  /** 人工检查点：只建档定位，不产生数值记录，单独列出 */
  manualPoints: number
  /** 有有效读数记录的传感器测点（不限时间） */
  pointsWithValidReading: number
  /** 最近一次有效采样落在新鲜窗口内的传感器测点 */
  pointsFresh: number
  openByLevel: Record<EventLevel, number>
  openTotal: number
  lastSampleTime: string | null
  lastEnteredAt: string | null
  sourceCounts: Record<RecordSource, number>
}

export function overviewOf(snapshot: AssistantSnapshot): OverviewCounts {
  const activePoints = snapshot.points.filter((row) => !row.archived)
  const sensors = activePoints.filter((row) => hasNumericReadings(row.metric))
  const sourceCounts: Record<RecordSource, number> = { manual: 0, device: 0, csv: 0 }
  for (const row of snapshot.records) sourceCounts[row.source] += 1

  let withReading = 0
  let fresh = 0
  for (const point of sensors) {
    const latest = latestValidRecord(snapshot.records, point.id)
    if (latest === null) continue
    withReading += 1
    if (freshnessOf(latest.sampleTime, snapshot.now) === 'current') fresh += 1
  }

  const openByLevel = emptyLevelCount()
  for (const row of snapshot.events) {
    if (row.status !== 'closed') openByLevel[row.level] += 1
  }

  // 采样时间与录入时间分开取最新：两者不同步正是"补录"要说明的事
  const bySample = sortedNewestFirst(snapshot.records, (row) => row.sampleTime)
  const byEntered = sortedNewestFirst(snapshot.records, (row) => row.enteredAt)

  return {
    activeBuildings: snapshot.buildings.filter((row) => !row.archived).length,
    activePoints: activePoints.length,
    sensorPoints: sensors.length,
    manualPoints: activePoints.length - sensors.length,
    pointsWithValidReading: withReading,
    pointsFresh: fresh,
    openByLevel,
    openTotal: openByLevel.yellow + openByLevel.orange + openByLevel.red,
    lastSampleTime: bySample.length === 0 ? null : bySample[0].sampleTime,
    lastEnteredAt: byEntered.length === 0 ? null : byEntered[0].enteredAt,
    sourceCounts,
  }
}

/** 某个测点的有效期数计数说明，供单点回答复用。 */
export function readingCountsOf(snapshot: AssistantSnapshot, pointId: string): { total: number; valid: number } {
  const rows = recordsOfPoint(snapshot.records, pointId)
  return { total: rows.length, valid: rows.filter((row) => row.quality === 'valid').length }
}
