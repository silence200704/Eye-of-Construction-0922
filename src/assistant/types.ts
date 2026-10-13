/**
 * 问筑瞳（本地数据讲解与操作导航助手）的稳定结果类型。
 *
 * 定位见《看板及功能简化计划_单日并行演示AI版》§问筑瞳：
 * **普通问答只读**——有限意图识别 + 实体消歧 + 只读数据选择器 + 固定回答模板，
 * 不调用外部 API、不猜测点、不编造读数、不推断真实在线；演示写入另走受确认的白名单出口。
 *
 * 这份类型是半屏界面与后续看板联动的唯一契约：字段只增不改，
 * 界面渲染不再自行拼装结论文字，避免出现"答案里一个数、卡片上另一个数"。
 */
import type { AskVideoPreview } from '@/types/media/video'
import type { Region } from '@/core/media/compare'
import type { DataSource, DeviceHealth, QualityFlag, RecordSource } from '@/types/domain'
import type { MediaCompareRecord, MediaFrameRef } from '@/types/media'
import type { TimeRange } from '@/core/chart/range'
import type { ReadingTrendModel } from '@/core/chart/dashboard'

/**
 * 意图。前四类即方案里的固定问法；`media_compare` 是"照片有变化吗"，
 * 影像链路由另一条工作线实现，本步先给出明确未接入的说明而不是装作听不懂。
 */
export type AskIntent =
  | 'campus_overview'
  | 'point_status'
  | 'point_trend'
  | 'media_reason'
  | 'capabilities'
  | 'event_reason'
  | 'open_events'
  | 'media_compare'
  | 'video_compare'
  /**
   * 视觉证据联动（方案 §34/§36）：同一测点的读数、趋势与照片证据放在一次回答里。
   * `visual_region` 是它的区域操作问法（把变化区域放大 / 完好墙面也变了吗）。
   */
  | 'visual_evidence'
  | 'visual_region'
  /** 读数恢复没有：拿最新有效读数与该事件证据里的阈值快照比，不改阈值也不自动关闭。 */
  | 'reading_recovery'
  /** 带我到 3D 看位置：只给既有白名单深链，不替用户跳转。 */
  | 'spatial_go'
  | 'demo_command'
  | 'demo_guide'
  | 'unknown'
  | 'point_compare'
  | 'event_replay'
  | 'case_search'
  | 'rule_simulate'

/**
 * 回答状态。
 * `need_choice` 专指同名或多项命中——必须由人选定，助手不替人猜；
 * `not_found` 表示当前数据集确实没有这个对象，不得回退到预置假答案。
 */
export type AskStatus = 'answered' | 'need_choice' | 'not_found' | 'unsupported' | 'awaiting_confirmation'

/**
 * 读数新鲜度：只描述"这条数据离现在多远"，**不代表设备是否在线**。
 * 本机没有设备心跳，`stale` 只能说"该去看看"，不能说"设备离线"。
 */
export type ReadingFreshness = 'current' | 'stale' | 'none'

/**
 * 视觉证据联动的执行阶段。
 *
 * 由编排在**每一步真正做完之后**上报（不是定时器编出来的进度），半屏据此显示
 * 「读取监测记录 → 核对关联影像 → 计算区域差异 → 整理结果」。
 */
export type AskStage = 'records' | 'media' | 'compare' | 'compose'

/** 关键数值：值本身是字符串（已按位数取整），单位单独给，界面不再解析。 */
export interface AskFact {
  label: string
  value: string
  unit: string
}

/** 时间口径：采样时间与录入时间分列，不合并成一个含义模糊的"时间"。 */
export interface AskTiming {
  /** 采样时间：这条数据描述的是哪个时刻的现场 */
  sampleTime: string
  /** 录入时间：这条数据是什么时候进本机库的 */
  enteredAt: string
  /** 采样时间明显早于录入时间 = 历史补录，回答里必须写明，不得当作实时上报 */
  isBackfill: boolean
  /** 修订次数 > 0 表示这条记录被改过，当前值不是最初录入的值 */
  revision: number
  freshness: ReadingFreshness
  /** 新鲜度的中文说明，含与当前刻度的间隔 */
  freshnessLabel: string
}

/** 来源与质量：质量标记决定这条数据能不能用来下结论。 */
export interface AskProvenance {
  source: RecordSource
  sourceLabel: string
  quality: QualityFlag
  qualityLabel: string
  qualityNote: string
  /** 测点档案来源：real=实测建档，demo=示例数据 */
  pointDataSource: DataSource
  pointDataSourceLabel: string
  /** 设备健康状态是**人工登记的字段**，不是心跳 */
  deviceHealth: DeviceHealth | 'none'
  deviceHealthLabel: string
}

/** 证据：回答里出现的原始记录与事件，界面据此展开对照。 */
export interface AskEvidence {
  kind: 'record' | 'event'
  /** 业务编号（记录号 / 事件号），可直接拿去和看板、详情页核对 */
  ref: string
  /** 内部主键，用于深链与二次查询 */
  id: string
  detail: string
}

/** 消歧候选：`label` 给人看，`id` 回传给下一轮提问。 */
export interface AskCandidate {
  id: string
  label: string
  detail: string
}

/**
 * 只读导航目标。`path`/`query` 一律由 actions.ts 的白名单生成，
 * 回答模板不许自己拼路由字符串——否则迟早拼出一个页面根本不认的深链。
 */
export interface AskLink {
  kind: AskLinkKind
  label: string
  path: string
  query: Record<string, string>
  /** true = 目标页面已能按对象 ID 直接定位；false = 只到页面，还要人工再选一次 */
  deep: boolean
  /** 口径说明：`deep: false` 时必须写清进去以后还要点什么 */
  note: string
}

/** 导航种类白名单；新增种类必须同时在 actions.ts 登记路由与说明。 */
export type AskLinkKind =
  | 'point_building'
  | 'point_trend'
  | 'points_trend'
  | 'media_page'
  | 'spatial_3d'
  | 'spatial_tour'
  | 'event_detail'
  | 'event_report'
  | 'issue_detail'
  | 'workorder_detail'
  | 'alarm_queue'
  | 'inspection_page'
  | 'campus_map'
  | 'overview'
  | 'monitor'
  | 'reports'
  | 'settings'

/**
 * 需要人确认后才执行的指令。
 *
 * 回答只**声明**、不执行；`enabled=true` 只代表界面可以打开确认弹窗。
 * 真正写入必须由人按“确认准备”，且由白名单出口复用既有演示场景仓储。
 */
export interface AskPendingCommand {
  id: string
  label: string
  kind: 'navigation' | 'write'
  requiresConfirmation: boolean
  enabled: boolean
  note: string
}

/** 影像对来源：`builtin` = 随包演示素材（设置页准备后按需读取），`session` = 当前会话里的影像。 */
export type MediaPairSource = 'builtin' | 'session'

/** 视觉证据里可选择的区域：登记裂缝区 / 登记完好墙面 / 用户自己框选。 */
export type AskRegionKey = 'crack' | 'control' | 'custom'

/** 归一化区域对：与 `core/media/compare.ts` 的 `Region` 同一口径，直接复用。 */
export interface AskRegionSet {
  crack: Region
  control: Region
}

/** 回答内的趋势小图：存当次提问的数值快照，不放动画。 */
export interface AskPointTrendPreview {
  kind: 'point_trend'
  pointCode: string
  label: string
  unit: string
  digits: number
  samples: { recordId: string; sampleTime: string; value: number }[][]
}

/** 回答内的照片对：只存会话帧 ID 与当次**实际**算出的结果，不存图片本身。 */
export interface AskMediaPairPreview {
  kind: 'media_pair'
  pointId: string
  beforeId: string
  afterId: string
  source: MediaPairSource
  /** 必须与照片一起展示的口径说明（实拍派生 / 模拟日期 / 演示关联） */
  note: string
  /** 这一对素材登记的区域；人工上传的照片没有登记区域，为 null */
  regions: AskRegionSet | null
}

/** 当前有效读数：**毫米来自监测记录**，不由照片换算。 */
export interface AskVisualCurrent {
  label: string
  value: string
  unit: string
  recordNo: string
  sampleTime: string
  freshnessLabel: string
  /** 相对这条记录自己那份基准的变化量；没有基准就是 null */
  delta: string | null
  deltaLabel: string
}

/**
 * 历史峰值：取自事件的证据快照（触发值的最大值），**不是当前读数**。
 * 所以它必须带事件编号与证据采样时间一起显示，免得被读成"现在的值"。
 */
export interface AskVisualPeak {
  label: string
  value: string
  unit: string
  levelLabel: string
  eventNo: string
  eventId: string
  sampleTime: string
  /** 峰值出自哪条证据（活跃 / 已被修订替代） */
  sourceNote: string
}

/** 视觉证据同屏：一次提问里同时给出这个测点的数值、趋势、照片与区域差异。 */
export interface AskVisualEvidencePreview {
  kind: 'visual_evidence'
  pointId: string
  pointCode: string
  pointName: string
  /** 楼栋 · 楼层 · 区域 */
  location: string
  pointDataSourceLabel: string
  source: MediaPairSource
  note: string
  /** 一对可比影像；只有一张影像时是 null，此时必须给 `single` */
  pair: AskMediaPairPreview | null
  /** 只有一张可比影像时的那一张 */
  single: MediaFrameRef | null
  /** 登记区域；没有登记时只能自己框选 */
  regions: AskRegionSet | null
  active: AskRegionKey
  /** 三个区域各自**实际算过**的结果；没算过就是 null */
  results: { crack: MediaCompareRecord | null; control: MediaCompareRecord | null; custom: MediaCompareRecord | null }
  current: AskVisualCurrent | null
  peak: AskVisualPeak | null
  event: { id: string; eventNo: string; levelLabel: string; statusLabel: string } | null
  trend: AskPointTrendPreview | null
  /** 方法与参数口径（像素差统计），界面原样展示 */
  method: string
  /** 问法要求把变化区域放大展示 */
  zoom: boolean
}

/**
 * 回答内的只读预览。
 * 一次回答可以有多段：数值趋势、照片对、视觉证据同屏各是一段，界面按数组顺序渲染。
 */
export interface AskCompareResult {
  kind: 'point_compare'; pointIds: string[]; range: TimeRange
  cards: { label: string; model: ReadingTrendModel }[]
}
export interface ReplayNode {
  id: string; at: string; title: string; detail: string; by: string
  recordNo?: string; level?: string; ruleVersion?: string; thresholds?: string
}
export interface AskReplayResult { kind: 'event_replay'; eventId: string; nodes: ReplayNode[] }
export interface CaseMatch {
  issueId: string; issueNo: string; eventId: string | null; pointId: string | null
  complete: boolean; gaps: string[]; reasons: string[]; measures: string; recheck: string; at: string
}
export interface AskCasesResult { kind: 'case_search'; total: number; rows: CaseMatch[] }
export interface AskSimulationResult {
  kind: 'rule_simulate'; range: TimeRange
  rows: { recordNo: string; original: string; candidate: string; reason: string; changed: boolean }[]
}
export type AskPreview = AskPointTrendPreview | AskMediaPairPreview | AskVisualEvidencePreview | AskVideoPreview
  | AskCompareResult | AskReplayResult | AskCasesResult | AskSimulationResult

/** 问答结果。字段顺序即界面建议的阅读顺序：结论 → 数值 → 时间来源 → 证据 → 去向。 */
export interface AskResult {
  question: string
  intent: AskIntent
  status: AskStatus
  /**
   * 本条回答讲的是哪个测点。
   *
   * 用途只有一个：把上下文续到下一轮，让「读数恢复了吗」「带我到 3D 看位置」「它怎么样」
   * 这类没有线索的追问仍然落在同一个测点上。讲不出具体测点时为 null（界面保持原来的上下文）。
   */
  pointId: string | null
  /** 一句话结论；状态不是 answered 时写清"缺什么"，绝不写"正常" */
  conclusion: string
  facts: AskFact[]
  timing: AskTiming | null
  provenance: AskProvenance | null
  evidence: AskEvidence[]
  candidates: AskCandidate[]
  /** 空态说明：没有适用规则、没有关联事件、没有有效记录时分别缺什么 */
  gaps: string[]
  links: AskLink[]
  pendingCommands: AskPendingCommand[]
  /** 导览仅描述当前对象与可否准备固定演示场景，不表示业务步骤已完成。 */
  guide: { eventId: string | null; canPrepare: boolean } | null
  /** 回答内的可视化预览；没有可展示的内容时是空数组，界面按顺序渲染 */
  previews: AskPreview[]
  /** 数据口径提示（人工登记状态、演示补录、无心跳等），界面需要原样展示 */
  dataNotes: string[]
  /** 本回答依据的"现在"刻度，取自共享时钟；由显式刷新推进 */
  computedAt: string
  context?: AskContext
  followups?: string[]
}

/**
 * 提问上下文：从对象详情唤起时带上当前对象。
 * 只在一轮内沿用，且每次提问都按当前数据集复核——数据集被替换后对象不存在，
 * 上下文自动失效（满足"切换数据集后清空旧对象引用"）。
 */
export interface AskContext {
  /** 候选点选仅对接下来的原问题生效。 */
  chosen?: boolean
  /** 详情页/看板已明确选中的测点 */
  pointId?: string
  /** 详情页/看板已明确选中的事件 */
  eventId?: string
  pointIds?: string[]
  range?: TimeRange
  caseIds?: string[]
  replayNode?: string
  simulation?: { yellow: number; orange: number; red: number }
  videoId?: string
}
