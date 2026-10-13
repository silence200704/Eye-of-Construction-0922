/**
 * 「某个传感器 / 测点现在什么状态」的回答模板。
 *
 * 阅读顺序固定：结论 → 最近有效读数与变化量 → 采样与录入时间 → 来源与质量 → 当前事件与去向。
 * 三条不能破的规矩：
 * 1. 只答"最近**有效**读数"，最新一条是存疑或无效时明说，不给别的数顶上；
 * 2. 没有有效读数就直接说缺什么，**不显示"正常"**；
 * 3. 风险等级只引用判定引擎生成的事件，助手不重算阈值。
 */
import { formatDateTime } from '@/core/time'
import { hasNumericReadings, qualityLabel } from '@/types/catalog'
import type { MonitorRecord } from '@/types/domain'
import { buildLink, buildSpatialLink, buildSpatialTourLink } from '../actions'
import type { AssistantSnapshot, DeviceRef } from '../selectors'
import {
  deltasOf,
  devicesOfPoint,
  factsOf,
  lastClosedEventOfPoint,
  latestAnyRecord,
  latestValidRecord,
  openEventsOfPoint,
  readingCountsOf,
  timingOf,
} from '../selectors'
import { levelText } from '../selectors/events'
import type { PointRef } from '../resolve'
import { DEVICE_HEALTH_NOTE, NO_DEVICE_NOTE, dataSourceLabel, draft, previewsOf, provenanceOf, type AnswerDraft } from './shared'
import { pointTrendPreview } from '../preview/pointTrend'

const JUDGE_NOTE = '风险等级与判定依据以规则引擎生成的预警事件为准，助手不重新计算阈值。'

export interface PointAnswerInput {
  snapshot: AssistantSnapshot
  point: PointRef
  /** 定位口径（来自 resolve.ts），回答里原样说明是怎么找到这个点的 */
  matchNote: string
}

export function answerPointStatus(input: PointAnswerInput): AnswerDraft {
  const { snapshot, point, matchNote } = input
  const device = devicesOfPoint(snapshot, point.id)[0] ?? null
  const notes = [`定位口径：${matchNote}`, JUDGE_NOTE]
  if (!hasNumericReadings(point.metric)) return manualPointAnswer(point, device, notes)
  const reading = latestValidRecord(snapshot.records, point.id)
  if (reading === null) return emptyReadingAnswer(snapshot, point, device, notes)
  return readingAnswer(snapshot, point, device, reading, notes)
}

/** 人工检查点：按设计不产生数值记录，回答要把"没有读数"和"数据缺失"分开说。 */
function manualPointAnswer(point: PointRef, device: DeviceRef | null, notes: string[]): AnswerDraft {
  return draft(`${point.code} ${point.name} 是人工检查点：按设计只做档案与定位，不产生数值记录，因此没有"当前读数"可答。`, {
    status: 'not_found',
    pointId: point.id,
    facts: [
      { label: '点位类型', value: '人工检查点', unit: '' },
      { label: '位置', value: `${point.buildingName} · ${point.floorName} · ${point.zoneId}`, unit: '' },
      { label: '绑定设备', value: device === null ? '无' : `${device.code} ${device.name}`, unit: '' },
    ],
    provenance: null,
    gaps: ['人工检查点按设计不产生数值记录，不能给出状态结论；到点检查结果在巡检任务里留痕。'],
    links: pointLinks(point),
    dataNotes: [...notes, '人工检查点不参与数值判定，因此不会生成结构预警事件。'],
  })
}

/** 没有有效读数：说明"最新一条是什么质量"以及"一共几条"，不给模糊的"没有数据"。 */
function emptyReadingAnswer(
  snapshot: AssistantSnapshot,
  point: PointRef,
  device: DeviceRef | null,
  notes: string[],
): AnswerDraft {
  const latestAny = latestAnyRecord(snapshot.records, point.id)
  const counts = readingCountsOf(snapshot, point.id)
  const gaps: string[] = []
  if (latestAny === null) {
    gaps.push('该测点在本机没有任何监测记录，需要先录入或导入数据。')
  } else {
    gaps.push(
      `该测点共 ${counts.total} 条记录，其中 ${counts.valid} 条质量标记为有效；` +
        `最新一条 ${latestAny.recordNo}（采样 ${formatDateTime(latestAny.sampleTime)}）质量标记为「${qualityLabel(latestAny.quality)}」，不能作为当前读数。`,
    )
  }
  gaps.push('数据不足时不显示"正常"：没有有效读数就无法给出风险状态。')
  return draft(`${point.code} ${point.name} 当前没有可用的有效读数，无法给出状态结论。`, {
    status: 'not_found',
    pointId: point.id,
    facts: [
      { label: '位置', value: `${point.buildingName} · ${point.floorName} · ${point.zoneId}`, unit: '' },
      { label: '记录条数', value: `${counts.total} 条（有效 ${counts.valid} 条）`, unit: '' },
    ],
    timing: latestAny === null ? null : timingOf(latestAny, snapshot.now),
    provenance: latestAny === null ? null : provenanceOf(latestAny, point, device, snapshot.now),
    evidence: latestAny === null ? [] : [{ kind: 'record', ref: latestAny.recordNo, id: latestAny.id, detail: '最新一条记录（质量标记不足以下结论）' }],
    gaps,
    links: pointLinks(point),
    dataNotes: [...notes, DEVICE_HEALTH_NOTE, ...(device === null ? [NO_DEVICE_NOTE] : [])],
  })
}

/** 正常路径：给出最近有效读数、变化量、时间、来源与当前事件。 */
function readingAnswer(
  snapshot: AssistantSnapshot,
  point: PointRef,
  device: DeviceRef | null,
  reading: MonitorRecord,
  notes: string[],
): AnswerDraft {
  const timing = timingOf(reading, snapshot.now)
  const open = openEventsOfPoint(snapshot.events, point.id)
  const latest = open[0] ?? null
  const values = factsOf(reading.values, point.metric)
  const deltas = deltasOf(reading.values, reading.baselineValues, point.metric)
  const valueText = values.map((row) => `${row.label} ${row.value}${row.unit}`).join('、')
  const eventText =
    latest === null ? '当前没有未关闭的预警事件' : `当前有未关闭的${levelText(latest.level)}事件 ${latest.eventNo}`
  const gaps = readingGaps(snapshot, point, reading, open.length > 0)

  return draft(
    `${point.code} ${point.name}：最近有效读数 ${valueText}，采样时间 ${formatDateTime(timing.sampleTime)}` +
      `${timing.isBackfill ? '（历史补录）' : ''}；${eventText}。`,
    {
      pointId: point.id,
      facts: [
        { label: '位置', value: `${point.buildingName} · ${point.floorName} · ${point.zoneId}`, unit: '' },
        { label: '档案来源', value: dataSourceLabel(point.dataSource), unit: '' },
        ...values,
        ...deltas,
        { label: '未关闭事件', value: latest === null ? '无' : `${latest.eventNo}（${levelText(latest.level)}）`, unit: '' },
      ],
      previews: previewsOf(pointTrendPreview(snapshot, point)),
      timing,
      provenance: provenanceOf(reading, point, device, snapshot.now),
      evidence: [
        { kind: 'record', ref: reading.recordNo, id: reading.id, detail: '最近有效读数' },
        ...(latest === null ? [] : [{ kind: 'event' as const, ref: latest.eventNo, id: latest.id, detail: `${levelText(latest.level)}事件` }]),
      ],
      gaps,
      links: pointLinks(point, open[0]?.id ?? '', snapshot),
      dataNotes: [...notes, DEVICE_HEALTH_NOTE, ...(device === null ? [NO_DEVICE_NOTE] : [])],
    },
  )
}

/** 把"这条读数有哪些需要说明的边界"集中在一个地方，避免漏标补录或修订。 */
function readingGaps(
  snapshot: AssistantSnapshot,
  point: PointRef,
  reading: MonitorRecord,
  hasOpenEvent: boolean,
): string[] {
  const gaps: string[] = []
  const latestAny = latestAnyRecord(snapshot.records, point.id)
  if (latestAny !== null && latestAny.id !== reading.id && latestAny.quality !== 'valid') {
    gaps.push(
      `比它更新的一条记录 ${latestAny.recordNo} 质量标记为「${qualityLabel(latestAny.quality)}」，已跳过；` +
        '上面给的是它之前最近的一条有效记录。',
    )
  }
  if (reading.isBackfill) gaps.push('该读数采样时间明显早于录入时间，属于历史补录，不代表实时上报。')
  if (reading.revision > 0) gaps.push(`该记录已被修订 ${reading.revision} 次，当前值为修订后数值，原始值保留在修订历史里。`)
  if (snapshot.ruleAt(point.id, snapshot.now) === undefined) {
    gaps.push('该测点当前没有适用的启用规则，因此不会有新的自动判定结果。')
  }
  if (!hasOpenEvent) {
    const closed = lastClosedEventOfPoint(snapshot.events, point.id)
    gaps.push(
      closed === null
        ? '该测点还没有关联的预警事件。'
        : `该测点最近一次事件 ${closed.eventNo} 已于 ${formatDateTime(closed.closedAt ?? '')} 关闭。`,
    )
  }
  return gaps
}

/** 去向：地图定位、趋势页、3D 楼层定位，以及事件与问题（都不直接派工）。 */
function pointLinks(point: PointRef, eventId = '', snapshot?: AssistantSnapshot): AnswerDraft['links'] {
  const links = [
    buildLink('point_building', point.buildingId),
    buildLink('point_trend', point.id),
    // 按"楼栋 + 楼层 + 测点"逐级定位到 3D 里的同一个点；页面打开前会再核对一遍归属
    buildSpatialLink({ buildingId: point.buildingId, floorId: point.floorId, pointId: point.id }),
    buildSpatialTourLink({ buildingId: point.buildingId, floorId: point.floorId, pointId: point.id }, eventId),
  ]
  if (eventId !== '') links.push(buildLink('event_detail', eventId), buildLink('event_report', eventId))
  if (snapshot !== undefined && eventId !== '') {
    const issue = snapshot.issues.find((row) => row.eventId === eventId)
    if (issue !== undefined) links.push(buildLink('issue_detail', issue.id))
  }
  return links
}
