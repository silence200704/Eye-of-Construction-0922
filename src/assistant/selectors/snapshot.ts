import type { SessionVideo, VideoAnalysis } from '@/types/media/video'
/**
 * 数据适配层：把现有 store 的只读状态拍成一份快照。
 *
 * 这是助手**唯一**接触 store 的地方——回答模板只认快照，
 * 因此模板可以脱离 Pinia 直接单测，也保证"页面看到的数"与"助手答的数"
 * 来自同一批 store 状态（方案要求看板、详情、问答三处数字一致）。
 *
 * 每次提问都重新拍一份：本地数据写入或重新载入后重问，自然得到更新后的结果。
 * 规则与基准的按时间选取直接复用 `archive.ruleFor` / `archive.baselineAt`，
 * 助手不自己再实现一套"哪一版生效"的判断。
 */
import { useArchiveStore } from '@/stores/archive'
import { useClockStore } from '@/stores/clock'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useMediaStore } from '@/stores/media'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useRecordsStore } from '@/stores/records'
import type { Baseline, Device, Point, DeviceHealth, MonitorRecord } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import type { MediaCompareRecord, MediaFrameRef } from '@/types/media'
import type { InspectionIssue, IssueStatus, RecheckOutcome, RecheckRound, WorkOrder } from '@/types/inspection'
import type { MonitoringRule } from '@/types/rules'
import { taskRefOf, type TaskRef } from '../guide/nfc'
import type { BuildingRef, PointRef } from '../resolve'

/** 设备的只读投影：健康状态是人工登记字段，回答里必须带着这个口径一起说。 */
export interface DeviceRef {
  id: string
  code: string
  name: string
  pointId: string
  health: DeviceHealth
  model: string
  rangeText: string
  unit: string
  mountPosition: string
  direction: string
  installDate: string
}

/** 问题上的复查只读投影：只够说明"这一轮谁负责、什么时候到期、有没有结论"。 */
export interface IssueRecheckRef {
  /** 已登记轮次 */
  count: number
  /** 尚未给出结论的那一轮；没有则 null */
  openRound: { subject: string; owner: string; dueDate: string } | null
  /** 最近一轮结论；没有则 null */
  latestOutcome: RecheckOutcome | null
}

/** 巡检任务的只读投影（导览定位任务与点位用）；保养任务另有自己的台账页。 */
export interface IssueRef {
  id: string
  issueNo: string
  /** 关联的预警事件；人工上报与巡检发现的问题为空 */
  eventId: string | null
  status: IssueStatus
  workOrderIds: string[]
  rechecks: IssueRecheckRef
}

/**
 * 工单的只读投影：只够画"处置阶段耗时"与跳转，不带照片、材料与审计细节。
 *
 * 字段直接取自领域类型，避免两处各写一份；看板图表的 `WorkOrderFacts` 是它的结构子集，
 * 代入 `buildStageDurations` 时由类型检查兜住一致性。
 *
 * `reviewedAt` 取首次验收结论（通过或退回都算"已验收"），
 * 所以"完工提交 → 验收"这一段对退回返工的工单也能量到一次。
 */
export interface WorkOrderRef
  extends Pick<
    WorkOrder,
    'id' | 'orderNo' | 'issueId' | 'eventId' | 'pointId' | 'status' | 'assignedAt' | 'submittedAt'
  > {
  reviewedAt: string | null
}

/** 会话影像的只读投影：问答只说来源/时间/测点/现象，不把 Blob 带进来 */
export interface MediaSnapshot {
  video?: SessionVideo | null
  videoAnalysis?: VideoAnalysis | null
  frames: MediaFrameRef[]
  /** 最近一次预设分析结果；没有就是还没跑过 */
  compare: MediaCompareRecord | null
  /** 本地演示视频是否已载入（只报"有没有"，不报内容） */
  videoLoaded: boolean
}

export interface AssistantSnapshot {
  details?: { points: Point[]; devices: Device[]; issues: InspectionIssue[]; orders: WorkOrder[] }
  /** 共享时钟的"现在"刻度 */
  now: string
  buildings: BuildingRef[]
  /** 含已归档测点（带 archived 标记），由选择器决定是否纳入统计 */
  points: PointRef[]
  devices: DeviceRef[]
  issues: IssueRef[]
  /** 工单只读投影（看板的"处置阶段耗时"与跳转都读它，不另接 store） */
  workOrders: WorkOrderRef[]
  /** 巡检任务投影（模拟 NFC 导览定位"哪条任务、哪个点位"） */
  tasks: TaskRef[]
  records: MonitorRecord[]
  events: AlarmEvent[]
  rules: MonitoringRule[]
  baselines: Baseline[]
  /** 当前页面会话里的影像（刷新即失；助手只读它，不写任何东西） */
  media: MediaSnapshot
  /** 按时间取该测点当时生效的规则版本（复用 archive.ruleFor） */
  ruleAt: (pointId: string, at: string) => MonitoringRule | undefined
  /** 按时间取该测点当时生效的基准版本（复用 archive.baselineAt） */
  baselineAt: (pointId: string, at: string) => Baseline | undefined
}

/**
 * 只读补齐 store。
 *
 * 刻意**不**调用 `archive.bootstrap()`：那条路径在空库上会写入示例数据，
 * 而本步的纪律是"问答不写库"。数据没载入时宁可回答"当前数据集为空"。
 */
export async function ensureStoresLoaded(): Promise<void> {
  const archive = useArchiveStore()
  const records = useRecordsStore()
  const events = useEventsStore()
  const issues = useIssueStore()
  const workOrders = useWorkOrderStore()
  const tasks = useTaskStore()
  const plans = usePlanStore()
  if (!archive.loaded) await archive.reload()
  if (!records.loaded) await records.load()
  if (!events.loaded) await events.load()
  if (!issues.loaded) await issues.reload()
  if (!workOrders.loaded) await workOrders.reload()
  if (!tasks.loaded) await tasks.reload()
  if (!plans.loaded) await plans.reload()
}

/**
 * 导览阶段的数据源**强制重读**（打开导览、从业务页返回、点「刷新数据」时调用）。
 *
 * 与 `ensureStoresLoaded` 的区别是"不管 loaded 与否都读一遍"：阶段卡要按数据库当前状态说话，
 * 缓存里那份可能是别处刚写完之前的版本。这里只读，不触发任何写路径。
 */
export async function reloadGuideSources(): Promise<void> {
  await reloadAssistantSources()
}

/** 服务端模式下提问前重读：事实必须来自本次服务端查询，不拿页面旧缓存回答"现在"。 */
export async function reloadAssistantSources(): Promise<void> {
  const archive = useArchiveStore()
  const records = useRecordsStore()
  const events = useEventsStore()
  const issues = useIssueStore()
  const workOrders = useWorkOrderStore()
  const tasks = useTaskStore()
  const plans = usePlanStore()
  await Promise.all([
    archive.reload(),
    records.load(),
    events.reload(),
    issues.reload(),
    workOrders.reload(),
    tasks.reload(),
    plans.reload(),
  ])
}

export function buildSnapshot(): AssistantSnapshot {
  const archive = useArchiveStore()
  const records = useRecordsStore()
  const events = useEventsStore()
  const issues = useIssueStore()
  const workOrders = useWorkOrderStore()
  const taskStore = useTaskStore()
  const planStore = usePlanStore()
  const media = useMediaStore()
  const clock = useClockStore()
  return {
    details: { points: [...archive.points], devices: [...archive.devices], issues: [...issues.issues], orders: [...workOrders.orders] },
    now: clock.nowKey,
    buildings: archive.buildings.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      archived: row.status !== 'active',
    })),
    points: archive.points.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      zoneId: row.zoneId,
      buildingId: row.buildingId,
      buildingName: archive.buildingById(row.buildingId)?.name ?? '未知楼栋',
      floorId: row.floorId,
      floorName: archive.floorById(row.floorId)?.name ?? '未知楼层',
      metric: row.metric,
      dataSource: row.dataSource,
      archived: row.status !== 'active',
    })),
    devices: archive.devices.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      pointId: row.pointId,
      health: row.health,
      model: row.model,
      rangeText: row.rangeText,
      unit: row.unit,
      mountPosition: row.mountPosition,
      direction: row.direction,
      installDate: row.installDate,
    })),
    issues: issues.issues.map((row) => ({
      id: row.id,
      issueNo: row.issueNo,
      eventId: row.eventId,
      status: row.status,
      workOrderIds: [...row.workOrderIds],
      rechecks: recheckRefOf(row.rechecks ?? []),
    })),
    workOrders: workOrders.orders.map((row) => ({
      id: row.id,
      orderNo: row.orderNo,
      issueId: row.issueId,
      eventId: row.eventId,
      pointId: row.pointId,
      status: row.status,
      assignedAt: row.assignedAt,
      submittedAt: row.submittedAt,
      reviewedAt: row.reviews[0]?.at ?? null,
    })),
    tasks: taskStore.tasks.map((row) => {
      const plan = planStore.byId(row.planId)
      return taskRefOf(row, plan?.name ?? '', plan?.code ?? '')
    }),
    records: [...records.records],
    events: [...events.events],
    rules: [...archive.rules],
    baselines: [...archive.baselines],
    media: {
      frames: media.frames.map((row) => ({
        id: row.id,
        pointId: row.pointId,
        origin: row.origin,
        capturedAt: row.capturedAt,
        label: row.label,
        timeCode: row.timeCode,
        videoId: row.videoId,
      })),
      compare: media.compare,
      videoLoaded: media.videoMeta !== null,
      video: media.videoMeta ? { ...media.videoMeta } : null,
      videoAnalysis: media.videoAnalysis,
    },
    ruleAt: (pointId, at) => archive.ruleFor(pointId, at),
    baselineAt: (pointId, at) => archive.baselineAt(pointId, at),
  }
}

export function findPoint(snapshot: AssistantSnapshot, pointId: string): PointRef | undefined {
  return snapshot.points.find((row) => row.id === pointId)
}

/** 复查轮次 → 只读投影：最近一轮在最后，未给结论的那一轮就是"当前待办"。 */
function recheckRefOf(rounds: RecheckRound[]): IssueRecheckRef {
  const last = rounds[rounds.length - 1]
  const open = last !== undefined && last.outcome === null ? last : undefined
  return {
    count: rounds.length,
    openRound: open === undefined ? null : { subject: open.subject, owner: open.owner, dueDate: open.dueDate },
    latestOutcome: last?.outcome ?? null,
  }
}

export function findEvent(snapshot: AssistantSnapshot, eventId: string): AlarmEvent | undefined {
  return snapshot.events.find((row) => row.id === eventId)
}

/** 测点名下的设备：正常只有一台，演示里按编号排序取第一台。 */
export function devicesOfPoint(snapshot: AssistantSnapshot, pointId: string): DeviceRef[] {
  return snapshot.devices.filter((row) => row.pointId === pointId).sort((a, b) => a.code.localeCompare(b.code))
}

export function issuesOfEvent(snapshot: AssistantSnapshot, eventId: string): IssueRef[] {
  return snapshot.issues.filter((row) => row.eventId === eventId)
}
