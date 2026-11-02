/**
 * V0.3 巡检与维修处置的领域模型。
 *
 * 与方案 §3 对齐的几条硬约束（状态不能混）：
 * - 检查任务完成 ≠ 问题解决：任务状态与问题状态是两套；
 * - 工单验收 ≠ 关联问题自动关闭：验收只把问题推进到待复查，关闭要另外动作；
 * - 观察中不算最终闭环；
 * - 模拟 NFC 不构成真实到场证明：界面必须写"模拟读卡"，人工兜底要留原因。
 */
import type { AuditFields } from './domain'

/* ---------------- 字典 ---------------- */

/** 计划类型：点检按设备生成清单，巡检按路线设必查点（方案 §3）。 */
export const PLAN_KINDS = [
  { key: 'inspection', name: '点检（按设备）', desc: '按设备台账生成检查清单' },
  { key: 'patrol', name: '巡检（按路线）', desc: '按楼层与区域设置必查点' },
] as const
export type PlanKind = (typeof PLAN_KINDS)[number]['key']

export const PLAN_CYCLE_UNITS = [
  { key: 'day', name: '每天' },
  { key: 'week', name: '每周' },
  { key: 'month', name: '每月' },
] as const
export type PlanCycleUnit = (typeof PLAN_CYCLE_UNITS)[number]['key']

/** 任务状态：未检查的点始终留在"待检查"，不因任务提交而变完成（方案 §3）。 */
export const TASK_STATUSES = [
  { key: 'pending', name: '待检查' },
  { key: 'checked', name: '已检查' },
  { key: 'partial', name: '部分完成' },
  { key: 'missed', name: '逾期未检' },
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]['key']

/**
 * 单个点位的检查状态：到点与检查完成是两件事。
 * 到点只证明"人到了这个点"，检查完成还要求必答清单都回答过；
 * 混成一个状态会出现"扫了卡就算查完了"的假完成。
 */
export const CHECK_STATUSES = [
  { key: 'pending', name: '待到点' },
  { key: 'arrived', name: '已到点，待检查' },
  { key: 'completed', name: '检查完成' },
] as const
export type CheckStatus = (typeof CHECK_STATUSES)[number]['key']

/** 清单项的作答结果；异常项必须带后续动作（建问题或写明无需建单）。 */
export interface ChecklistAnswer {
  key: string
  label: string
  result: 'ok' | 'abnormal' | null
  note: string
}

/** 一次到点尝试的留痕：成功的与失败的都追加，不覆盖历史。 */
export interface CheckInAttempt {
  at: string
  method: CheckMethod
  labelRead: string
  labelExpected: string
  labelVersion: number | null
  fallbackReason: string
  passed: boolean
  message: string
}

/** 到点方式：一致才算到达；人工兜底要留原因，且不允许把标签不符写成完成。 */
export const CHECK_METHODS = [
  { key: 'nfc', name: '模拟 NFC 读卡' },
  { key: 'manual', name: '人工兜底签到' },
] as const
export type CheckMethod = (typeof CHECK_METHODS)[number]['key']

/** 问题来源：传感器预警、巡检发现、人工上报共用同一问题池。 */
export const ISSUE_SOURCES = [
  { key: 'sensor', name: '传感器预警' },
  { key: 'inspection', name: '巡检发现' },
  { key: 'report', name: '人工上报' },
  { key: 'maintenance', name: '保养发现' },
] as const
export type IssueSource = (typeof ISSUE_SOURCES)[number]['key']

/** 问题状态（方案 §3 的状态表，与数据状态、任务状态互不混用）。 */
export const ISSUE_STATUSES = [
  { key: 'pending_review', name: '待审核' },
  { key: 'investigating', name: '排查中' },
  { key: 'repairing', name: '处理中' },
  { key: 'pending_recheck', name: '待复查' },
  { key: 'observing', name: '观察中' },
  { key: 'closed', name: '已关闭' },
] as const
export type IssueStatus = (typeof ISSUE_STATUSES)[number]['key']

/** 复查结论三态（方案 §4）。系统不替人下结论 —— 三种都由复查人明确选择，逾期也不会自动关问题。 */
export const RECHECK_OUTCOMES = [
  { key: 'recovered', name: '确认恢复', hint: '复查确认已恢复：问题关闭，原工单与预警事件仍可回看' },
  { key: 'observing', name: '继续观察', hint: '尚未稳定：延长观察期，必须登记下一次复查的目标日期' },
  { key: 'recurred', name: '复发转处置', hint: '问题再次出现：退回待审核重新安排处置，不新建无关问题' },
] as const
export type RecheckOutcome = (typeof RECHECK_OUTCOMES)[number]['key']

/**
 * 一轮复查登记。
 *
 * 工单验收通过只把问题推进到"待复查"，**必须有人登记复查事项、责任人与目标日期**；
 * 到期后由责任人给出结论；结论若是"继续观察"，就再登记一轮，历史轮次全部保留。
 */
export interface RecheckRound {
  /** 复查事项：要复查什么 */
  subject: string
  /** 责任人 */
  owner: string
  /** 目标日期（YYYY-MM-DD，本地日期） */
  dueDate: string
  at: string
  by: string
  /** 本轮结论；null = 尚未复查 */
  outcome: RecheckOutcome | null
  outcomeAt: string | null
  outcomeBy: string
  outcomeNote: string
  /** 新维修周期开始时被系统终止的旧轮次；保留历史，不再参与结论与统计 */
  invalidatedAt?: string
  invalidatedReason?: string
}

/** 审核出口六种（方案 §3）：原始报告一律保留，不做覆盖式编辑。 */
export const REVIEW_ACTIONS = [
  { key: 'to_repair', name: '转维修工单', hint: '现场可修的设备类问题' },
  { key: 'to_investigate', name: '转专业排查', hint: '建筑结构类问题交专业单位判断' },
  { key: 'recheck', name: '安排复查', hint: '情况不明，需再次测量或补拍证据' },
  { key: 'need_evidence', name: '退回补充', hint: '图片、位置、描述或测量数据不足' },
  { key: 'link_object', name: '关联既有对象', hint: '关联已有问题或既有预警事件，不重复建单' },
  { key: 'close_no_fault', name: '无需处理并关闭', hint: '必须写明依据' },
] as const
export type ReviewAction = (typeof REVIEW_ACTIONS)[number]['key']

/**
 * 二级分类（处理结果）。
 *
 * 六个一级出口是给评委与管理者看的主干；二级分类记录"具体是什么情况"，
 * 例如"关联既有对象"下分关联问题与关联预警事件，"无需处理并关闭"下分未发现异常/误报/非结构部位/已当场处理。
 * 这样既不会出现八个并列按钮，也不会把业务差异丢掉 —— 二级分类会写进审核意见与时间线。
 */
export const REVIEW_CATEGORIES: Record<ReviewAction, { key: string; name: string }[]> = {
  to_repair: [
    { key: 'equipment', name: '设备故障' },
    { key: 'general', name: '一般维修' },
  ],
  to_investigate: [
    { key: 'crack', name: '建筑裂缝' },
    { key: 'tilt', name: '倾斜' },
    { key: 'structure', name: '结构安全' },
  ],
  recheck: [
    { key: 'unclear', name: '情况不明' },
    { key: 'remeasure', name: '需再次测量或补拍证据' },
  ],
  need_evidence: [
    { key: 'image', name: '图片不足' },
    { key: 'location', name: '位置不足' },
    { key: 'description', name: '描述不足' },
    { key: 'measurement', name: '测量数据不足' },
  ],
  link_object: [
    { key: 'issue', name: '关联已有问题' },
    { key: 'event', name: '关联既有预警事件' },
  ],
  close_no_fault: [
    { key: 'no_fault', name: '未发现异常' },
    { key: 'false_alarm', name: '误报' },
    { key: 'reading_stable', name: '读数稳定' },
    { key: 'non_structural', name: '非结构部位' },
    { key: 'handled', name: '已当场处理' },
  ],
}

/** 工单状态：派工 → 接单 → 处理 → 提交待验收 → 验收通过 / 退回。 */
export const WORK_ORDER_STATUSES = [
  { key: 'created', name: '待派工' },
  { key: 'assigned', name: '已派工待接单' },
  { key: 'repairing', name: '处理中' },
  { key: 'submitted', name: '待验收' },
  { key: 'verified', name: '验收通过' },
  { key: 'returned', name: '验收退回' },
] as const
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number]['key']

/** 工单来源：手工建单、预警转单、人工问题转单（方案 §3）。 */
export const WORK_ORDER_ORIGINS = [
  { key: 'manual', name: '手工建单' },
  { key: 'event', name: '预警转单' },
  { key: 'issue', name: '人工问题转单' },
] as const
export type WorkOrderOrigin = (typeof WORK_ORDER_ORIGINS)[number]['key']

/** 照片用途：现场/维修前/维修后/验收，审计链要能按阶段看。 */
export const ATTACHMENT_KINDS = [
  { key: 'scene', name: '现场照片' },
  { key: 'before', name: '维修前' },
  { key: 'after', name: '维修后' },
  { key: 'acceptance', name: '验收照片' },
] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]['key']

/** 照片数量与体积上限（方案 §3 + 评审建议）：每问题最多 3 张、单问题不超过 600 KB。 */
export const ATTACHMENT_LIMITS = {
  perIssue: 3,
  perOrder: 3,
  targetBytes: 200 * 1024,
  totalBytes: 600 * 1024,
} as const

/** 未发现异常而关闭时必须写依据（方案 §3 的第六种出口）。 */
export const NO_FAULT_MIN_LENGTH = 10

/* ---------------- 实体 ---------------- */

/** 检查清单项：模板定义在计划上，执行结果落在任务里。 */
export interface ChecklistItem {
  key: string
  label: string
  required: boolean
  hint: string
}

/** 周期：按天/周/月 + 间隔 + 执行时刻（本地时间，形如 09:00）。 */
export interface PlanCycle {
  unit: PlanCycleUnit
  interval: number
  atTime: string
}

/** 巡检计划。 */
export interface InspectionPlan extends AuditFields {
  id: string
  code: string
  name: string
  kind: PlanKind
  buildingId: string
  floorIds: string[]
  /** 必查点：巡检路线的点位；点检计划按设备所在测点自动纳入 */
  pointIds: string[]
  cycle: PlanCycle
  startDate: string
  endDate: string | null
  owner: string
  executorRole: string
  checklist: ChecklistItem[]
  /** 启用中才会生成新任务；停用后既有任务保留（方案：停用不等于删除历史） */
  enabled: boolean
  remark: string
  rev?: number
}

/** 点位检查结果（任务内逐点一条）。 */
export interface TaskCheckResult {
  pointId: string
  status: CheckStatus
  checkedAt: string | null
  /** 入口方式：模拟读卡或人工兜底 */
  method: CheckMethod | null
  /** 当次读到的标签编号与登记的编号 */
  labelRead: string
  labelExpected: string
  /** 读取时该标签的版本（换标签会递增，历史记录保留当时的版本） */
  labelVersion: number | null
  /** 人工兜底的原因；错点不得计入完成 */
  fallbackReason: string
  /** 到点尝试历史：失败的尝试也留着，事后能看出"当时扫的是哪张卡" */
  attempts: CheckInAttempt[]
  checklist: ChecklistAnswer[]
  /**
   * 清单里出现异常时的后续动作：关联真实问题，或写明无需建问题的依据。
   * `linkedIssueId` 由仓储校验（问题必须存在且属于本任务与点位），不接受页面自己勾选。
   */
  abnormalHandling: { linkedIssueId: string | null; reason: string }
  issueIds: string[]
}

/**
 * 任务上的计划快照：生成那一刻的计划范围与归属，之后不再随计划改动。
 *
 * 为什么必须快照：计划是可以被修改的（换执行角色、增删必查点、调整楼层）。
 * 若任务实时读计划，改一次计划就会把历史任务"重新分配"给新角色、把已经查过的点
 * 换成新的范围，历史留痕当场失效。任务的范围、归属与审计解释都以快照为准。
 */
export interface TaskPlanSnapshot {
  planCode: string
  planName: string
  executorRole: string
  buildingId: string
  floorIds: string[]
  pointIds: string[]
  /** 生成时的检查清单模板，任务详情按它逐项作答 */
  checklist: ChecklistItem[]
}

/** 巡检任务：由计划按周期生成；范围与归属取生成时的快照。 */
export interface InspectionTask extends AuditFields {
  /** 持久标识 = 计划 ID + 执行时刻（见 taskKeyOf）；同一计划同一时刻天然唯一 */
  id: string
  taskNo: string
  planId: string
  /** 建索引用的冗余字段，权威值在 planSnapshot.buildingId */
  buildingId: string
  planSnapshot: TaskPlanSnapshot
  plannedAt: string
  dueAt: string
  status: TaskStatus
  results: TaskCheckResult[]
  issueIds: string[]
  rev?: number
}

/** 巡检问题（三类来源共用）。 */
export interface InspectionIssue extends AuditFields {
  id: string
  issueNo: string
  source: IssueSource
  /** 提交标识：同一标识重复提交不重复建单（幂等键） */
  submissionKey: string
  pointId: string | null
  buildingId: string
  floorId: string
  zoneId: string
  /** 关联预警事件（来源为传感器预警时） */
  eventId: string | null
  taskId: string | null
  /**
   * 由哪条保养任务转出的问题（来源为「保养发现」时非空）。
   * 与 `MaintenanceExecution.issueId` 互为反向：任务详情能跳到问题，问题也能回到任务，
   * 一致性检查按这一对字段报「保养转问题断链」。
   */
  maintenanceTaskId: string | null
  anomalyType: string
  description: string
  photos: string[]
  status: IssueStatus
  reviewAction: ReviewAction | null
  /** 二级分类（处理结果），与一级出口一起留痕 */
  reviewCategory: string
  reviewedAt: string | null
  reviewedBy: string
  reviewNote: string
  /** 关联既有对象：关联到的那条原问题 */
  duplicateOf: string | null
  /** 关联既有对象：关联到的那次预警事件 */
  linkedEventId: string | null
  /** 反向关系：有哪些问题关联到了本条（目标问题保留"关联来源"清单） */
  linkedFrom: string[]
  workOrderIds: string[]
  /**
   * 复查轮次，最近一轮在最后。
   * 可选：V1-C 之前写入的问题行没有这个字段，读取时按空数组处理（见 core/inspection/recheck.roundsOf）。
   */
  rechecks?: RecheckRound[]
  timeline: IssueTimelineEntry[]
  rev?: number
}

export interface IssueTimelineEntry {
  at: string
  by: string
  byRole: string
  action: string
  detail: string
}

/** 照片附件：只留压缩后的图与缩略图，不留原始大图。 */
export interface IssueAttachment {
  id: string
  issueId: string | null
  workOrderId: string | null
  /**
   * 归属的保养任务（V1-D 起）。
   * 照片必须**有且只有一个归属**（问题 / 工单 / 保养任务），否则会变成查不到出处的游离附件；
   * 旧行没有这个字段，读取时按 null 处理。
   */
  maintenanceTaskId?: string | null
  kind: AttachmentKind
  /**
   * 上传时草稿的标识。
   * 有了它，重试时能认出"这张草稿其实已经入库了、只是还没关联到问题上"，
   * 从而去补关联而不是再存一遍（否则会留下重复附件）。
   */
  draftId: string
  fileName: string
  mimeType: string
  /** 压缩后的字节数 */
  size: number
  width: number
  height: number
  uploadedAt: string
  uploadedBy: string
  capturedAt: string | null
  blob: Blob
  thumb: Blob
  /** 服务端附件版本与原件地址（本地演示库没有） */
  rev?: number
  contentUrl?: string
}

/** 工单验收/退回记录：每次动作都追加，不覆盖。 */
export interface WorkOrderReview {
  at: string
  by: string
  byRole: string
  action: 'verify' | 'return'
  result: 'pass' | 'fail'
  note: string
}

/** 维修工单。 */
export interface WorkOrder extends AuditFields {
  id: string
  orderNo: string
  origin: WorkOrderOrigin
  issueId: string | null
  eventId: string | null
  pointId: string | null
  title: string
  status: WorkOrderStatus
  assignee: string
  assigneeId?: string
  assignedBy: string
  assignedAt: string | null
  dueAt: string | null
  measures: string
  materials: string
  photos: string[]
  submittedAt: string | null
  acceptedById?: string
  reviews: WorkOrderReview[]
  timeline: IssueTimelineEntry[]
  rev?: number
}

/* ---------------- 事件关闭的前置依据 ---------------- */

/**
 * 关闭预警事件要有的处置依据（方案 §3 与评审要求）：
 * 关联工单验收通过，或安全管理人员填写"无需维修"的现场核查结论；
 * 两种都仍须满足连续 3 条恢复复测。
 */
export interface CloseBasisCheck {
  ok: boolean
  /** 采用的依据类型 */
  kind: 'work_order' | 'no_repair' | 'none'
  reason: string
}
