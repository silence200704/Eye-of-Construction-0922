/** 看板三块概览：只读同一快照，按实体去重；不推断在线、风险或业务转化率。 */
import { freshnessOf, latestValidRecord, openEvents } from '@/assistant/selectors'
import type { AssistantSnapshot } from '@/assistant/selectors'
import { hasNumericReadings, metricDef } from '@/types/catalog'
import { WORK_ORDER_STATUSES } from '@/types/inspection'

export interface InsightTarget { id: string; label: string }
export interface InsightRow {
  key: string
  label: string
  count: number
  color: string
  targets: InsightTarget[]
  levels?: { yellow: number; orange: number; red: number }
}
export interface InsightModel {
  total: number
  rows: InsightRow[]
  empty: string
  note: string
}

function scopedPoints(snapshot: AssistantSnapshot, ids: string[]) {
  const scope = new Set(ids)
  return snapshot.points.filter(p => scope.has(p.id) && !p.archived && hasNumericReadings(p.metric))
}

/** 分母是当前范围在册传感器测点，每个测点只取最新有效记录。 */
export function buildSamplingCoverage(snapshot: AssistantSnapshot, ids: string[]): InsightModel {
  const points = scopedPoints(snapshot, ids)
  const rows: InsightRow[] = [
    { key: 'current', label: '近期有效采样', count: 0, color: '#087f8c', targets: [] },
    { key: 'stale', label: '较早有效采样', count: 0, color: '#c96a06', targets: [] },
    { key: 'none', label: '无有效读数', count: 0, color: '#8b9ca4', targets: [] },
  ]
  for (const point of points) {
    const record = latestValidRecord(snapshot.records, point.id)
    const state = freshnessOf(record?.sampleTime ?? null, snapshot.now)
    const row = rows.find(item => item.key === state)!
    row.count += 1
    row.targets.push({ id: point.id, label: `${point.code} ${point.name}` })
  }
  return {
    total: points.length, rows, empty: '当前范围没有传感器测点',
    note: '按最新有效记录与共享时钟的新鲜度规则分类，近期窗口30分钟；采样新鲜度不代表设备在线。',
  }
}

/** 只统计未关闭事件；按测点所属指标分组，等级直接读取事件，不重新判定。 */
export function buildAlertComposition(snapshot: AssistantSnapshot, ids: string[]): InsightModel {
  const points = scopedPoints(snapshot, ids)
  const lookup = new Map(points.map(point => [point.id, point]))
  const groups = new Map<string, InsightRow>()
  for (const point of points) {
    if (!groups.has(point.metric)) groups.set(point.metric, {
      key: point.metric, label: metricDef(point.metric).name, count: 0, color: '#087f8c',
      targets: [], levels: { yellow: 0, orange: 0, red: 0 },
    })
  }
  const events = new Map(openEvents(snapshot.events).map(event => [event.id, event]))
  for (const event of events.values()) {
    const point = lookup.get(event.pointId)
    if (!point) continue
    const row = groups.get(point.metric)!
    row.count += 1
    row.levels![event.level] += 1
    row.targets.push({ id: event.id, label: `${event.eventNo} · ${point.code}` })
  }
  const rows = [...groups.values()]
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0), rows, empty: '当前范围无未关闭预警',
    note: '当前未关闭事件按ID计一次，证据与升级不增加条数；黄、橙、红取事件当前等级。',
  }
}

/** 工单状态是互斥的当前库存，不是漏斗、完成率或整条业务链的进度。 */
export function buildOrderInventory(snapshot: AssistantSnapshot, ids: string[]): InsightModel {
  const scope = new Set(scopedPoints(snapshot, ids).map(point => point.id))
  const orders = [...new Map(snapshot.workOrders.map(order => [order.id, order])).values()]
    .filter(order => order.pointId !== null && scope.has(order.pointId))
  const colors = ['#8b9ca4', '#547fa6', '#087f8c', '#c96a06', '#4d8064', '#c0362c']
  const rows = WORK_ORDER_STATUSES.map((status, index): InsightRow => {
    const group = orders.filter(order => order.status === status.key)
    return {
      key: status.key, label: status.name, count: group.length, color: colors[index],
      targets: group.map(order => ({ id: order.id, label: order.orderNo })),
    }
  })
  return {
    total: orders.length, rows, empty: '当前测点范围暂无关联工单',
    note: '按工单自身测点归属与当前状态计数；无测点归属的工单不纳入。验收通过不等于问题或事件已关闭。',
  }
}
