import {
  answerAmbiguous,
  answerCampusOverview,
  answerEventReason,
  answerMediaCompare,
  answerNoObject,
  answerOpenEvents,
  answerPointStatus,
  answerUnknownQuestion,
  answerWriteRequest,
  answerPrepareRedDemo,
  type AnswerDraft,
} from './answers'
import {
  extractEntities,
  hasPointClue,
  looksLikeWriteCommand,
  normalizeQuestion,
  parseIntent,
  type QuestionEntities,
} from './parse'
import { resolvePoint, toCandidates, type PointRef } from './resolve'
import { answerGuide, selectGuideEvent } from './guide/plan'
import { existingOnly } from './query/specific'
import { answerSpatialGo } from './linkage/nav'
import {
  buildSnapshot,
  bySeverity,
  ensureStoresLoaded,
  eventCandidates,
  findEvent,
  findEventByNo,
  findPoint,
  lastClosedEventOfPoint,
  levelText,
  openEventsByLevel,
  openEventsOfPoint,
  type AssistantSnapshot,
} from './selectors'
import type { MediaCompareRecord } from '@/types/media'
import type { AskContext, AskIntent, AskResult, AskStage } from './types'
import { featureIntent } from './features/intent'
import { answerFeature } from './features/answer'

export interface AskOptions {
  visualResult?: MediaCompareRecord
  /** 从对象详情唤起时带上的当前对象；每次提问都按当前数据集复核，失效即忽略 */
  context?: AskContext
  /**
   * 阶段上报：视觉证据联动在每一步**真正做完之后**回调一次，界面据此显示进度。
   * 普通问法不报阶段，界面沿用原来的三步固定说法。
   */
  onStage?: (stage: AskStage) => void
}

export async function askZhutong(question: string, options: AskOptions = {}): Promise<AskResult> {
  const text = question.trim()
  await ensureStoresLoaded()
  const snapshot = buildSnapshot()
  if (text === '') return assembleAnswer('', 'unknown', answerUnknownQuestion(), snapshot)

  const q = normalizeQuestion(text)
  const entities = extractEntities(q)
  const intent = featureIntent(text, options.context) ?? parseIntent(q, entities)
  const draft = await pickDraft({
    q,
    entities,
    intent,
    snapshot,
    context: options.context ?? {},
    visualResult: options.visualResult,
    onStage: options.onStage,
  })
  return assembleAnswer(text, intent, draft, snapshot)
}

interface DraftInput {
  visualResult?: MediaCompareRecord
  q: ReturnType<typeof normalizeQuestion>
  entities: QuestionEntities
  intent: AskIntent
  snapshot: AssistantSnapshot
  context: AskContext
  /** 视觉问答的阶段上报；其它问法不用 */
  onStage?: (stage: AskStage) => void
}

/**
 * 按意图分派到模板；无法识别时再区分"写入指令"与"完全没认出"。
 * 视觉证据那条要按需读取会话影像与内置素材，所以整体是异步的。
 */
async function pickDraft(input: DraftInput): Promise<AnswerDraft> {
  if (/修改规则|保存规则|保存阈值/.test(input.q.compact) && !/试算/.test(input.q.compact)) return answerWriteRequest()
  let feature: AnswerDraft | null
  try { feature = answerFeature({ snapshot: input.snapshot, question: input.q.dashed, context: input.context, intent: input.intent }) }
  catch (cause) { return { status: 'unsupported', conclusion: cause instanceof Error ? cause.message : String(cause) } }
  if (feature !== null) return feature
  if (input.intent === 'capabilities') {
    const { answerCapabilities } = await import('./query/answers')
    return answerCapabilities()
  }
  if (input.intent === 'point_trend' || input.intent === 'media_reason') {
    const { answerTrend, answerMediaReason } = await import('./query/answers')
    const located = locatePoint(input)
    if (isDraft(located)) return located
    const args = { snapshot: input.snapshot, ...located, previous: input.visualResult }
    return input.intent === 'point_trend' ? answerTrend(args) : answerMediaReason(args)
  }
  if (input.intent === 'demo_command') return answerPrepareRedDemo()
  if (input.intent === 'demo_guide') {
    if (hasPointClue(input.entities) && input.entities.pointCode === null) {
      const located = locatePoint(input)
      if (isDraft(located)) return located
      return answerGuide(input.snapshot, selectGuideEvent(input.snapshot, { pointId: located.point.id }, input.entities.eventNo, located.point.code))
    }
    return answerGuide(input.snapshot, selectGuideEvent(input.snapshot, input.context, input.entities.eventNo, input.entities.pointCode))
  }
  if (input.intent === 'video_compare') {
    const located = locatePoint({ ...input, context: Object.keys(input.context).length ? input.context : { pointId: input.snapshot.media.video?.pointId } })
    if (!('point' in located)) return located
    const { answerVideo } = await import('./video/answer')
    return answerVideo(input.snapshot, located.point, input.q.dashed)
  }
  if (looksLikeWriteCommand(input.q)) return answerWriteRequest()
  if (input.intent === 'visual_evidence' || input.intent === 'visual_region') return visualDraft(input)
  if (input.intent === 'reading_recovery') return spatialOrRecovery(input, 'recovery')
  if (input.intent === 'spatial_go') return spatialOrRecovery(input, 'spatial')
  if (input.intent === 'media_compare') return mediaDraft(input)
  if (input.intent === 'campus_overview') return answerCampusOverview(input.snapshot)
  if (input.intent === 'open_events') return answerOpenEvents(input.snapshot)
  if (input.intent === 'event_reason') return eventDraft(input)
  if (input.intent === 'point_status') return pointDraft(input)
  return answerUnknownQuestion()
}

/**
 * 影像类问法：把问句里的测点线索（如果有）交给影像回答。
 * 没点名测点时按"会话里影像最多的那个测点"回答，并把定位口径写出来 —— 不假装用户指定过。
 */
function mediaDraft(input: DraftInput): AnswerDraft {
  if (!hasPointClue(input.entities)) {
    const inherited = contextPoint(input)
    if (inherited !== null) {
      return answerMediaCompare({ snapshot: input.snapshot, point: inherited, matchNote: '沿用上一轮明确选定的测点' })
    }
    return answerMediaCompare({ snapshot: input.snapshot, point: null, matchNote: '问句没有点名测点，按当前会话影像所属测点回答' })
  }
  const resolution = resolvePoint({
    question: input.q.compact,
    entities: input.entities,
    buildings: input.snapshot.buildings,
    points: input.snapshot.points,
  })
  if (resolution.status === 'ambiguous') {
    return answerAmbiguous(`${resolution.reason}。`, toCandidates(resolution.points))
  }
  if (resolution.status === 'none') return answerNoObject(resolution.reason)
  return answerMediaCompare({ snapshot: input.snapshot, point: resolution.points[0], matchNote: resolution.reason })
}

/** 上下文里的测点：只在它仍存在于当前数据集时沿用（数据集被替换后自动失效）。 */
function contextPoint(input: DraftInput): PointRef | null {
  const id = input.context.pointId ?? findEvent(input.snapshot, input.context.eventId ?? '')?.pointId ?? ''
  const point = id === '' ? undefined : findPoint(input.snapshot, id)
  return point === undefined || point.archived ? null : point
}

/** 上下文里的测点是否就在这批候选里：是的话说明"人已经选过了"。 */
function pickFromCandidates(input: DraftInput, candidates: PointRef[]): PointRef | null {
  const chosen = contextPoint(input)
  if (chosen === null) return null
  return candidates.find((row) => row.id === chosen.id) ?? null
}

/** 定位到的测点与它的口径说明；定位不了时直接给出"缺什么"的回答。 */
interface LocatedPoint {
  point: PointRef
  matchNote: string
}

/**
 * 测点定位（单测点、视觉证据、读数恢复、3D 导航共用同一条路径）：
 * 问句线索 → 候选里已选定的那个 → 上一轮明确选定的上下文 → 如实说缺什么。
 */
function locatePoint(input: DraftInput): LocatedPoint | AnswerDraft {
  if (input.entities.eventNo !== null) {
    const event = findEventByNo(input.snapshot.events, input.entities.eventNo)
    const point = event === null ? undefined : findPoint(input.snapshot, event.pointId)
    return point === undefined || point.archived ? answerNoObject('当前事件没有可用的在册测点。') : { point, matchNote: `按事件 ${event?.eventNo} 的测点定位` }
  }
  const resolution = resolvePoint({
    question: input.q.compact,
    entities: input.entities,
    buildings: input.snapshot.buildings,
    points: input.snapshot.points,
  })
  if (resolution.status === 'ambiguous') {
    /*
     * 候选里选过的那一个优先。
     * 用户点了候选以后问的往往还是同一句话（`一层走廊人工检查点怎么样`），
     * 那句话本身仍然含糊，但"这一轮到底指哪个点"已经由人在候选里定过了 —— 再弹一次候选等于没听见。
     */
    const picked = pickFromCandidates(input, resolution.points)
    if (picked !== null) return { point: picked, matchNote: '沿用你在候选里选定的测点' }
    return answerAmbiguous(`${resolution.reason}。`, toCandidates(resolution.points))
  }
  if (resolution.status !== 'none') return { point: resolution.points[0], matchNote: resolution.reason }
  // 问句里没有线索时，才沿用上一轮明确选定的测点
  if (!hasPointClue(input.entities)) {
    const inherited = contextPoint(input)
    if (inherited !== null) return { point: inherited, matchNote: '沿用上一轮明确选定的测点' }
    // 上一轮明确选过、但这份数据集里已经没有了：说清楚是"对象没了"，不是"你没说清"
    if ((input.context.pointId ?? '') !== '') return answerStaleContext('测点')
  }
  return answerNoObject(resolution.reason)
}

/** 当前会话里"有影像的测点"：只报事实，不做筛选排序；没有影像时返回 null。 */
function sessionImagePoints(snapshot: AssistantSnapshot): PointRef[] | null {
  const ids = [...new Set(snapshot.media.frames.map((row) => row.pointId))]
  const points = ids
    .map((id) => findPoint(snapshot, id))
    .filter((row): row is PointRef => row !== undefined)
  return points.length === 0 ? null : points
}

/** 判定是"定位到了"还是"直接给缺什么"：草稿一定有 conclusion，定位结果没有。 */
function isDraft(value: LocatedPoint | AnswerDraft): value is AnswerDraft {
  return 'conclusion' in value
}

function pointDraft(input: DraftInput): AnswerDraft {
  const located = locatePoint(input)
  if (isDraft(located)) return located
  return answerPointStatus({ snapshot: input.snapshot, point: located.point, matchNote: located.matchNote })
}

/**
 * 视觉证据联动：先在同一个测点上下文中定位（问句点名 → 沿用上一轮），
 * 再交给编排去取影像、算区域差异。区域与放大由问法里的动作决定。
 */
async function visualDraft(input: DraftInput): Promise<AnswerDraft> {
  const located = locatePoint(input)
  if (!isDraft(located)) return startVisual(input, located)
  /*
   * 问句里没有线索、也没有上下文时，按"当前会话影像所属测点"回答 ——
   * 与影像问法同一口径，并且把这条口径写进回答里（`matchNote`）。
   * 有多个测点都有影像时先给候选：候选是给"人还没定过对象"用的，不能替人猜。
   */
  if (hasPointClue(input.entities) || Object.keys(input.context).length > 0) return located
  const holders = sessionImagePoints(input.snapshot)
  if (holders === null) return located
  if (holders.length > 1) {
    return answerAmbiguous(
      `当前有 ${holders.length} 个测点都有会话影像，需要指定要看哪一个。`,
      holders.map((row) => ({
        id: row.id,
        label: `${row.code} ${row.name}`,
        detail: `位置：${row.buildingName} · ${row.floorName}`,
      })),
    )
  }
  return startVisual(input, { point: holders[0], matchNote: '问句没有点名测点，按当前会话影像所属测点回答' })
}

/** 走视觉证据联动：区域与放大按问法里的动作决定。 */
async function startVisual(input: DraftInput, located: LocatedPoint): Promise<AnswerDraft> {
  const { answerVisualEvidence } = await import('./linkage/run')
  const action = input.entities.visualAction
  return answerVisualEvidence({
    snapshot: input.snapshot,
    point: located.point,
    matchNote: located.matchNote,
    active: action === 'control' ? 'control' : 'crack',
    zoom: action === 'zoom',
    customRegion: null,
    onStage: input.onStage,
    allowBuiltin: !existingOnly(input.q.compact),
  })
}

/** 读数恢复与 3D 导航：都只需要"哪个测点"，判定与坐标一律引用已有数据。 */
async function spatialOrRecovery(input: DraftInput, kind: 'recovery' | 'spatial'): Promise<AnswerDraft> {
  const located = locatePoint(input)
  if (isDraft(located)) return located
  const args = { snapshot: input.snapshot, point: located.point, matchNote: located.matchNote }
  if (kind === 'spatial') return answerSpatialGo(args)
  const { answerReadingRecovery } = await import('./linkage/recovery')
  return answerReadingRecovery(args)
}

function eventDraft(input: DraftInput): AnswerDraft {
  const explicit = explicitEventDraft(input)
  if (explicit !== null) return explicit
  const inherited = findEvent(input.snapshot, input.context.eventId ?? '')
  if (inherited !== undefined && !hasPointClue(input.entities)) {
    return answerEventReason({ snapshot: input.snapshot, event: inherited, matchNote: '沿用上一轮明确选定的事件' })
  }
  const fromPoint = pointEventDraft(input)
  if (fromPoint !== null) return fromPoint
  if ((input.context.eventId ?? '') !== '') return answerStaleContext('事件')
  return redEventDraft(input)
}

/** 上一轮明确选定的对象在当前数据集里找不到：提示重新选择，不退回全库兜底。 */
function answerStaleContext(kind: '测点' | '事件'): AnswerDraft {
  return answerNoObject(
    `上一轮选定的${kind}已不在当前数据集：可能已被删除、已归档，或数据集已切换。请重新选择${kind}后再问。`,
  )
}

/** 1) 问句里写了事件编号。 */
function explicitEventDraft(input: DraftInput): AnswerDraft | null {
  const no = input.entities.eventNo
  if (no === null) return null
  const event = findEventByNo(input.snapshot.events, no)
  if (event === null) return answerNoObject(`当前数据集里没有事件编号 ${no}。`)
  return answerEventReason({ snapshot: input.snapshot, event, matchNote: `按事件编号 ${event.eventNo} 精确匹配` })
}

/** 2) 问句里指定了测点：取该测点的未关闭事件；没有就用最近一次已关闭事件说明。 */
function pointEventDraft(input: DraftInput): AnswerDraft | null {
  if (!hasPointClue(input.entities) && contextPoint(input) === null) return null
  const located = locatePoint(input)
  if (isDraft(located)) return located
  const point = located.point
  const open = openEventsOfPoint(input.snapshot.events, point.id)
  if (open.length > 0) {
    return answerEventReason({ snapshot: input.snapshot, event: open[0], matchNote: `该测点当前等级最高的一条未关闭事件（${point.code}）` })
  }
  const closed = lastClosedEventOfPoint(input.snapshot.events, point.id)
  if (closed !== null) {
    return answerEventReason({
      snapshot: input.snapshot,
      event: closed,
      matchNote: `该测点当前没有未关闭事件，说明的是最近一次已关闭事件（${point.code}）`,
    })
  }
  return answerNoObject(`${point.code} ${point.name} 在本机没有关联的预警事件。`)
}

/** 3) 兜底：当前唯一的未关闭红色事件；多于一条就列候选，一条都没有就照实说。 */
function redEventDraft(input: DraftInput): AnswerDraft {
  const reds = openEventsByLevel(input.snapshot.events, 'red')
  if (reds.length === 1) {
    return answerEventReason({ snapshot: input.snapshot, event: reds[0], matchNote: '当前唯一的未关闭红色事件' })
  }
  if (reds.length > 1) {
    // 候选里选过的那条优先，理由与单测点消歧一致：已经由人定过的对象不再重新弹候选
    const inherited = findEvent(input.snapshot, input.context.eventId ?? '')
    const picked = inherited === undefined ? undefined : reds.find((row) => row.id === inherited.id)
    if (picked !== undefined) {
      return answerEventReason({ snapshot: input.snapshot, event: picked, matchNote: '沿用你在候选里选定的事件' })
    }
    return answerAmbiguous(
      `当前有 ${reds.length} 条未关闭红色事件，需要指定要解释哪一条。`,
      eventCandidates(reds, input.snapshot.points),
    )
  }
  const others = bySeverity(input.snapshot.events.filter((row) => row.status !== 'closed'))
  if (others.length > 0) {
    return answerNoObject(
      `当前没有未关闭的红色事件；未关闭事件里等级最高的是 ${others[0].eventNo}（${levelText(others[0].level)}）。`,
    )
  }
  return answerNoObject('当前没有任何未关闭的预警事件，也没有红色事件可以解释。')
}

export function assembleAnswer(question: string, intent: AskIntent, draft: AnswerDraft, snapshot: AssistantSnapshot): AskResult {
  return {
    question,
    intent,
    status: draft.status ?? 'answered',
    pointId: draft.pointId ?? null,
    conclusion: draft.conclusion,
    facts: draft.facts ?? [],
    timing: draft.timing ?? null,
    provenance: draft.provenance ?? null,
    evidence: draft.evidence ?? [],
    candidates: draft.candidates ?? [],
    gaps: draft.gaps ?? [],
    links: draft.links ?? [],
    pendingCommands: draft.pendingCommands ?? [],
    guide: draft.guide ?? null,
    previews: draft.previews ?? [],
    dataNotes: draft.dataNotes ?? [],
    computedAt: snapshot.now,
    ...(draft.context ? { context: draft.context } : {}),
    ...(draft.followups ? { followups: draft.followups.slice(0,3) } : {}),
  }
}
