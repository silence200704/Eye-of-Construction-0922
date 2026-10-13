/**
 * 小瞳视觉证据组合（纯函数）。
 *
 * 职责只有一件：把一个测点的**数值、趋势、照片与区域差异**整理成一段可核对的说法。
 * 三条边界在这里一次定死，别处不再放宽：
 * 1. 毫米来自**监测记录**，像素占比来自**图像计算**，两者不互相换算；
 * 2. 历史峰值取自**事件证据里的记录**，与当前有效读数分开显示，不把旧峰值说成当前值；
 * 3. 不重算阈值、不重算状态机：事件等级与状态直接读事件本体，区域结论直接读
 *    现有像素差异算法算出的结果，助手只负责把它们摆在一起并说清口径。
 */
import { fmtNumber } from '@/core/format'
import { LUMA_MAX_EDGE } from '@/core/media/capture'
import { DEFAULT_COMPARE_OPTIONS, compareStatusLabel } from '@/core/media/compare'
import { formatDateTime } from '@/core/time'
import { metricDef } from '@/types/catalog'
import type { MonitorRecord } from '@/types/domain'
import type { AlarmEvent, EventEvidence } from '@/types/events'
import { EVENT_LEVEL_LABEL, EVENT_STATUS_LABEL } from '@/types/events'
import { frameOriginLabel, type MediaFrameRef } from '@/types/media'
import { buildLink, buildSpatialLink } from '../actions'
import { dataSourceLabel, draft, provenanceOf, type AnswerDraft } from '../answers/shared'
import { pointTrendPreview } from '../preview/pointTrend'
import type { PointRef } from '../resolve'
import type { AssistantSnapshot } from '../selectors'
import { devicesOfPoint } from '../selectors/snapshot'
import { deltasOf, latestValidRecord, recordsOfPoint, timingOf } from '../selectors'
import { lastClosedEventOfPoint, openEventsOfPoint } from '../selectors'
import type {
  AskLink,
  AskMediaPairPreview,
  AskRegionKey,
  AskVisualCurrent,
  AskVisualEvidencePreview,
  AskVisualPeak,
} from '../types'

/** 三个区域的中文名：界面、结论与按钮共用一处，避免同一块框换个地方叫别的名字。 */
export const REGION_LABEL: Record<AskRegionKey, string> = {
  crack: '登记裂缝区',
  control: '完好墙面（对照）',
  custom: '你自己框选的区域',
}

/**
 * 方法与参数：从现有常量拼出来，不在文字里重写一遍数字 ——
 * 阈值改了这句话跟着变，不会出现"界面写着 8%、代码里是别的数"。
 */
export const COMPARE_METHOD_TEXT =
  `像素级亮度差异统计：两张图先缩到同一长边（${LUMA_MAX_EDGE}）取亮度，再按区域逐像素比较；` +
  `像素差阈值 ${DEFAULT_COMPARE_OPTIONS.pixelDelta}，差异占比阈值 ${(DEFAULT_COMPARE_OPTIONS.changedRatio * 100).toFixed(0)}%，` +
  `整体曝光差超过 ${DEFAULT_COMPARE_OPTIONS.exposureTolerance} 判为不可比对，区域至少 ${DEFAULT_COMPARE_OPTIONS.minPixels} 像素。`

const PRESET_REGION_NOTE = '裂缝区与完好墙面是**人工预设的示范区域**，不是模型自动识别出来的裂缝。'

const NO_RECOGNITION_NOTE =
  '这里没有联网识别、没有识别准确率、也没有模型推理过程：区域差异就是同一块区域里逐像素亮度差的统计。'

export interface VisualEvidenceInput {
  snapshot: AssistantSnapshot
  point: PointRef
  /** 一对可比影像；只有一张影像时是 null（此时必须给单图） */
  pair: AskMediaPairPreview | null
  /** 只有一张影像时的那一张 */
  single: MediaFrameRef | null
  /** 三个区域各自**实际算过**的结果 */
  results: AskVisualEvidencePreview['results']
  active: AskRegionKey
  /** 定位口径（沿用上下文 / 问句点名） */
  matchNote: string
  /** 问法要求放大变化区域 */
  zoom?: boolean
}

export function composeVisualEvidence(input: VisualEvidenceInput): AnswerDraft {
  const { snapshot, point, pair } = input
  const reading = latestValidRecord(snapshot.records, point.id)
  const event = relevantEventOf(snapshot, point.id)
  const current = reading === null ? null : currentOf(reading, point, snapshot.now)
  const peak = peakOf(snapshot, point, event)
  const trend = trendOf(snapshot, point)
  const active = input.results[input.active]
  const regions = pair === null ? null : pair.regions
  const preview: AskVisualEvidencePreview = {
    kind: 'visual_evidence',
    pointId: point.id,
    pointCode: point.code,
    pointName: point.name,
    location: `${point.buildingName} · ${point.floorName} · ${point.zoneId}`,
    pointDataSourceLabel: dataSourceLabel(point.dataSource),
    source: pair?.source ?? 'session',
    note: pair?.note ?? '',
    pair,
    single: input.single,
    regions,
    active: input.active,
    results: input.results,
    current,
    peak,
    event: event === null ? null : eventRef(event),
    trend,
    method: COMPARE_METHOD_TEXT,
    zoom: input.zoom === true,
  }

  const device = devicesOfPoint(snapshot, point.id)[0] ?? null
  return draft(conclusionOf(input, current, event, active, input.results), {
    pointId: point.id,
    facts: factsOf(input, current, peak, event, pair),
    previews: [preview],
    timing: reading === null ? null : timingOf(reading, snapshot.now),
    provenance: reading === null ? null : provenanceOf(reading, point, device, snapshot.now),
    evidence: [
      ...(peak === null ? [] : [{ kind: 'record' as const, ref: peak.recordNo, id: peak.recordId, detail: '事件证据记录（历史峰值来源）' }]),
      ...(reading === null ? [] : [{ kind: 'record' as const, ref: reading.recordNo, id: reading.id, detail: '最新有效读数' }]),
      ...(event === null ? [] : [{ kind: 'event' as const, ref: event.eventNo, id: event.id, detail: `${EVENT_LEVEL_LABEL[event.level]}事件` }]),
      ...(pair === null ? [] : [
        { kind: 'record' as const, ref: '影像前一张', id: pair.beforeId, detail: pair.note },
        { kind: 'record' as const, ref: '影像后一张', id: pair.afterId, detail: pair.note },
      ]),
    ],
    gaps: visualGaps(input, current, reading, event, active),
    links: visualLinks(point, event),
    dataNotes: [
      `定位口径：${input.matchNote}`,
      '数值（毫米）来自监测记录，像素占比来自图像计算；两者是不同口径，不互相换算。',
      '历史峰值取自事件证据里已落库的记录，与当前有效读数分开显示，界面不会把它标成"当前值"。',
      '事件等级、状态与判定明细直接引用规则引擎生成的事件，助手不重新计算阈值、也不改事件状态。',
      NO_RECOGNITION_NOTE,
      '区域结论不生成正式预警、也不关闭事件；是否处置由人现场复核后在原工作台按流程完成。',
    ],
  })
}

/** 一段话结论：先读数、再影像、最后事件状态 —— 三者各自带口径，不合成一个"结论数"。 */
function conclusionOf(
  input: VisualEvidenceInput,
  current: AskVisualCurrent | null,
  event: AlarmEvent | null,
  active: AskVisualEvidencePreview['results'][AskRegionKey],
  results: AskVisualEvidencePreview['results'],
): string {
  const { point, pair } = input
  const head = `${point.code} ${point.name}：`
  const readingText = current === null
    ? '本机没有质量标记为有效的读数，所以没有"当前值"可报'
    : `当前有效读数 ${current.value} ${current.unit}（记录 ${current.recordNo}，采样 ${formatDateTime(current.sampleTime)}）`
  const eventText = event === null
    ? '该测点没有关联的预警事件。'
    : `关联事件 ${event.eventNo}（${EVENT_LEVEL_LABEL[event.level]}）当前状态「${EVENT_STATUS_LABEL[event.status]}」。`
  if (pair === null) {
    return `${head}${readingText}。当前只有一张可比影像，仅供裂缝形态参考，缺少可比影像，因此不给任何变化结论。${eventText}`
  }
  const other: AskRegionKey = input.active === 'crack' ? 'control' : 'crack'
  const otherResult = results[other]
  const imageText = active === null || active === undefined
    ? '这一对素材还没有跑区域差异计算'
    : active.status === 'incomparable'
      ? `${REGION_LABEL[input.active]}不可比对：${active.summary}`
      : `${REGION_LABEL[input.active]}的实际像素差异 ${(active.changedRatio * 100).toFixed(1)}%，结论「${compareStatusLabel(active.status)}」`
  const otherText = otherResult === null || otherResult === undefined ? '' : otherResult.status === 'incomparable'
    ? `；${REGION_LABEL[other]}不可比对：${otherResult.summary}`
    : `；${REGION_LABEL[other]} ${(otherResult.changedRatio * 100).toFixed(1)}%，结论「${compareStatusLabel(otherResult.status)}」`
  return `${head}${readingText}；${imageText}${otherText}。${eventText}`
}

/** 迷你趋势：复用趋势页那条曲线的口径，取不到就不画。 */
function trendOf(snapshot: AssistantSnapshot, point: PointRef): AskVisualEvidencePreview['trend'] {
  const preview = pointTrendPreview(snapshot, point)
  return preview !== null && preview.kind === 'point_trend' ? preview : null
}

/** 关键数值：位置、来源、事件，以及素材口径。 */
function factsOf(
  input: VisualEvidenceInput,
  current: AskVisualCurrent | null,
  peak: AskVisualPeak | null,
  event: AlarmEvent | null,
  pair: AskMediaPairPreview | null,
): NonNullable<AnswerDraft['facts']> {
  const { point, single } = input
  const material = pair === null
    ? (single === null ? '没有影像' : `只有一张影像（${frameOriginLabel(single.origin)}），不可对比`)
    : pair.source === 'builtin' ? '随包演示证据素材' : '当前会话影像'
  return [
    { label: '测点', value: `${point.code} ${point.name}`, unit: '' },
    { label: '位置', value: `${point.buildingName} · ${point.floorName} · ${point.zoneId}`, unit: '' },
    { label: '档案来源', value: dataSourceLabel(point.dataSource), unit: '' },
    { label: '证据素材', value: material, unit: '' },
    ...(current === null ? [] : [{ label: current.label, value: current.value, unit: current.unit }]),
    ...(peak === null ? [] : [{ label: `${peak.label}（事件证据）`, value: peak.value, unit: peak.unit }]),
    { label: '关联事件', value: event === null ? '该测点没有关联的预警事件' : `${event.eventNo}（${EVENT_LEVEL_LABEL[event.level]}，${EVENT_STATUS_LABEL[event.status]}）`, unit: '' },
    { label: '区域口径', value: pair === null || pair.regions === null ? '没有登记区域：可在卡片里自己框选' : '登记裂缝区 + 完好墙面（人工预设）', unit: '' },
  ]
}

/**
 * 空态说明。这里写的正是"两个口径各说各的"和"照片能证明什么、不能证明什么"，
 * 所以哪怕一切正常也会出现，不做折叠。
 */
function visualGaps(
  input: VisualEvidenceInput,
  current: AskVisualCurrent | null,
  reading: MonitorRecord | null,
  event: AlarmEvent | null,
  active: AskVisualEvidencePreview['results'][AskRegionKey],
): string[] {
  const gaps: string[] = []
  if (input.pair === null) {
    gaps.push('只有一张影像时不给变化结论；需要至少两张同一取景范围的照片才能做像素差异统计。')
    gaps.push('这张图仅供裂缝形态参考，不能证明裂缝在增长，也不给出毫米数。')
    return gaps
  }
  gaps.push('照片与监测记录之间是**演示关联**：不是现场同期连续拍摄，素材说明见卡片顶部。')
  gaps.push('区域结论只覆盖被框的那一块；框外面没有比对，换一块可能得到不同结果。')
  gaps.push(PRESET_REGION_NOTE)
  gaps.push('像素差异不能独立证明结构裂缝增长，也不生成正式预警、不关闭事件。')
  if (active !== undefined && active !== null && active.status === 'incomparable') {
    gaps.unshift(`本次比对判为不可比对：${active.summary}`)
  }
  if (reading === null) gaps.push('该测点没有质量标记为有效的记录，因此没有当前读数；数据不足时不显示"正常"。')
  if (event === null) gaps.push('该测点还没有关联的预警事件，因此没有历史峰值可引。')
  const trend = readingTrendOf(input.snapshot.records, input.point)
  if (trend !== null) gaps.push(`${trend.text}。`)
  if (trend !== null && active !== undefined && active !== null && active.status !== 'incomparable') {
    gaps.push(evidenceMismatch(active.status, trend.direction, current))
  }
  return gaps
}

/** 读数与影像两个口径不一致时，把两个事实并排列出来，不替用户下结论。 */
function evidenceMismatch(status: string, direction: 'up' | 'down' | 'flat', current: AskVisualCurrent | null): string {
  const unit = current?.unit ?? ''
  if (status === 'stable' && direction === 'up') {
    return `读数在上升，而登记裂缝区的影像差异低于阈值：两个口径不矛盾 —— 毫米来自记录、像素占比来自图像，` +
      `影像差异弱只能说明这一对照片在该区域看不出明显变化，不能反过来说记录不对。`
  }
  if (status === 'changed' && direction !== 'up') {
    return `影像上登记区域有像素差异，而最近两次有效读数没有上升${unit === '' ? '' : `（同口径单位 ${unit}）`}：` +
      `可能是光照、角度或表面污渍造成的差异，仍需人工现场复核才能下结论。`
  }
  return status === 'changed'
    ? '像素差异与读数变化方向一致，但这只是演示素材上的现象，不足以作为处置依据。'
    : '读数与影像都没有明显变化；没有变化也不等于结构安全，判定仍以规则引擎与人工复核为准。'
}

/**
 * 最近两次有效读数。
 *
 * **用途是做"两者是否一致"的对照，不是判定**：这里只做同口径单位下的简单比较，
 * 不计算判定值、不套阈值 —— 那是规则引擎的事。
 */
function readingTrendOf(records: MonitorRecord[], point: PointRef): { direction: 'up' | 'down' | 'flat'; text: string } | null {
  const field = metricDef(point.metric).fields[0]
  if (field === undefined) return null
  const valid = recordsOfPoint(records, point.id).filter((row) => row.quality === 'valid')
  const last = valid[valid.length - 1]
  const prev = valid[valid.length - 2]
  if (last === undefined || prev === undefined) return null
  const a = prev.values[field.key]
  const b = last.values[field.key]
  if (a === undefined || b === undefined) return null
  const direction = b > a ? 'up' : b < a ? 'down' : 'flat'
  return {
    direction,
    text: `最近两次有效读数：${fmtNumber(a, field.digits)} → ${fmtNumber(b, field.digits)} ${field.unit}` +
      `（${formatDateTime(prev.sampleTime)} → ${formatDateTime(last.sampleTime)}）`,
  }
}

/** 当前有效读数：值、单位、记录号、采样时间与相对该记录自带基准的变化量。 */
function currentOf(reading: MonitorRecord, point: PointRef, now: string): AskVisualCurrent | null {
  const field = metricDef(point.metric).fields[0]
  if (field === undefined) return null
  const raw = reading.values[field.key]
  if (raw === undefined) return null
  const delta = deltasOf(reading.values, reading.baselineValues, point.metric)[0]
  return {
    label: field.label,
    value: fmtNumber(raw, field.digits),
    unit: field.unit,
    recordNo: reading.recordNo,
    sampleTime: reading.sampleTime,
    freshnessLabel: timingOf(reading, now).freshnessLabel,
    delta: delta === undefined ? null : `${delta.value}${delta.unit}`,
    deltaLabel: delta === undefined ? '相对基准变化' : `${delta.label}（该记录录入时的基准版本）`,
  }
}

/**
 * 历史峰值：该事件全部证据记录里、**同一指标字段**的最大值。
 *
 * 取记录值而不是证据里的判定值：判定值（例如"宽度 − 基准"）和目标字段不是同一个量，
 * 混在一起会让人把 0.82 mm 的宽度当成 0.82 mm 的变化。记录不在本机时宁可不给峰值。
 */
function peakOf(snapshot: AssistantSnapshot, point: PointRef, event: AlarmEvent | null): (AskVisualPeak & { recordId: string; recordNo: string }) | null {
  if (event === null) return null
  const field = metricDef(point.metric).fields[0]
  if (field === undefined) return null
  const rows = [
    ...event.evidences.map((evidence) => ({ evidence, superseded: false })),
    ...event.supersededEvidences.map((row) => ({ evidence: row.evidence, superseded: true })),
  ]
  let best: { value: number; evidence: EventEvidence; superseded: boolean } | null = null
  for (const row of rows) {
    const record = snapshot.records.find((item) => item.id === row.evidence.recordId)
    const raw = record?.values[field.key]
    if (raw === undefined || !Number.isFinite(raw)) continue
    if (best === null || raw > best.value) best = { value: raw, evidence: row.evidence, superseded: row.superseded }
  }
  if (best === null) return null
  return {
    label: field.label,
    value: fmtNumber(best.value, field.digits),
    unit: field.unit,
    levelLabel: EVENT_LEVEL_LABEL[best.evidence.level],
    eventNo: event.eventNo,
    eventId: event.id,
    recordId: best.evidence.recordId,
    recordNo: best.evidence.recordNo,
    sampleTime: best.evidence.sampleTime,
    sourceNote: `取自事件证据记录 ${best.evidence.recordNo}${best.superseded ? '（已被修订替代，保留在事件里供审计）' : ''}`,
  }
}

/** 该测点当前该看哪条事件：优先未关闭、等级最高的那条；没有就用最近一次已关闭的。 */
function relevantEventOf(snapshot: AssistantSnapshot, pointId: string): AlarmEvent | null {
  return openEventsOfPoint(snapshot.events, pointId)[0] ?? lastClosedEventOfPoint(snapshot.events, pointId)
}

function eventRef(event: AlarmEvent): AskVisualEvidencePreview['event'] {
  return {
    id: event.id,
    eventNo: event.eventNo,
    levelLabel: EVENT_LEVEL_LABEL[event.level],
    statusLabel: EVENT_STATUS_LABEL[event.status],
  }
}

/**
 * 去向：3D 定位（同一测点）、预警依据、完整影像对比排在最前 —— 卡片底部就展示这三个；
 * 其余（事件报告、趋势）留给回答的常规链接行。
 */
function visualLinks(point: PointRef, event: AlarmEvent | null): AskLink[] {
  const links: AskLink[] = [
    buildSpatialLink({ buildingId: point.buildingId, floorId: point.floorId, pointId: point.id }),
  ]
  // 前三项就是卡片底部的三个按钮，顺序与布局一致：3D 定位 → 预警依据 → 完整影像对比
  if (event !== null) links.push(buildLink('event_detail', event.id))
  links.push(buildLink('media_page', point.id))
  if (event !== null) links.push(buildLink('event_report', event.id))
  links.push(buildLink('point_trend', point.id))
  return links
}

/**
 * 这个测点一张可比影像都没有时的回答。
 *
 * 不装作"看一眼就知道"：说清缺什么、去哪儿补，并且把唯一入口（系统设置）写在最前面。
 * `scenarioReady` 指设置页那条视觉演示场景是否已就绪，用来决定提示语气。
 */
export function noFramesDraft(input: {
  snapshot: AssistantSnapshot
  point: PointRef
  matchNote: string
  scenarioReady: boolean
}): AnswerDraft {
  const { point, scenarioReady } = input
  const gaps = scenarioReady
    ? [
        '视觉演示素材已经准备好，但还没有读取到当前会话：再问一次这句话就会按需读取（素材随包提供，只放会话、刷新即失）。',
        '也可以到影像对比页手动加入照片：人工上传同一位置的两张，或从本地演示视频抽关键帧。',
      ]
    : [
        '请先到系统设置点「一键载入全链演示数据」：那是临时演示数据的唯一入口，会同时把视觉演示素材标记为就绪。',
        '准备好以后回到这里再问一次，我会按同一个测点读取记录、照片与区域差异。',
      ]
  gaps.push('本系统不接摄像头、不接校园监控、也不调用在线 AI；没有影像时不会凭图片编造裂缝宽度。')
  return draft(`${point.code} ${point.name}：当前会话里没有这个测点的影像，照片对比暂时无从谈起。`, {
    status: 'not_found',
    facts: [
      { label: '测点', value: `${point.code} ${point.name}`, unit: '' },
      { label: '位置', value: `${point.buildingName} · ${point.floorName} · ${point.zoneId}`, unit: '' },
    ],
    gaps,
    links: [buildLink('media_page', point.id), buildLink('point_trend', point.id), buildLink('settings')],
    dataNotes: [`定位口径：${input.matchNote}`, NO_RECOGNITION_NOTE],
  })
}
