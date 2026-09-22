/**
 * 三类来源的问题汇聚与审核出口（纯函数）。
 *
 * 方案 §3：
 * - 传感器预警、巡检发现、人工上报共用同一问题池，重复提交不能重复建单；
 * - 反复提交：同一提交标识只建一条问题；
 * - 审核支持六种出口，原始报告一律保留（只在问题上追加时间线，不覆盖描述与照片）。
 */
import type { InspectionIssue, IssueSource, ReviewAction } from '@/types/inspection'
import { NO_FAULT_MIN_LENGTH, REVIEW_ACTIONS, REVIEW_CATEGORIES } from '@/types/inspection'

/**
 * 提交标识：只用于"同一次提交动作重试时不重复建单"。
 * 含来源是刻意的 —— 巡检发现与人工上报是两次真实动作，各自重试都不该重复落库；
 * 跨来源的疑似重复交给 candidateDuplicates() 提示，由审核人员决定是否关联。
 */
export function submissionKeyOf(input: {
  source: IssueSource
  pointId: string | null
  buildingId: string
  anomalyType: string
  at: string
  /** 预警转单时带事件编号，保证同一次预警只汇总一次 */
  eventId?: string | null
  windowMinutes?: number
}): string {
  if (input.eventId !== undefined && input.eventId !== null && input.eventId !== '') return `event:${input.eventId}`
  const window = input.windowMinutes ?? 10
  const bucket = Math.floor(new Date(input.at).getTime() / (window * 60_000))
  const place = input.pointId ?? input.buildingId
  return `${input.source}:${place}:${input.anomalyType}:${bucket}`
}

/**
 * 汇聚判定：同一提交标识已存在问题时不重复建单，返回已存在的那条。
 * 预警事件与人工上报分开判定：预警按事件编号归并（一次预警只对应一条问题）。
 */
export function findDuplicate(issues: InspectionIssue[], key: string): InspectionIssue | undefined {
  return issues.find((row) => row.submissionKey === key)
}

/**
 * 跨来源疑似重复候选：同一位置/区域、同一异常类型、仍开放（未关闭）、落在时间窗内。
 * 只做提示，不静默合并 —— 两次发现的人员、照片与时间线都是现场事实，关联时要保留。
 */
export function candidateDuplicates(
  issues: InspectionIssue[],
  probe: { pointId: string | null; buildingId: string; zoneId: string; anomalyType: string; at: string; windowHours?: number },
  excludeKey = '',
): InspectionIssue[] {
  const window = probe.windowHours ?? 24
  const at = new Date(probe.at).getTime()
  return issues.filter((row) => {
    if (row.status === 'closed') return false
    if (row.submissionKey === excludeKey && excludeKey !== '') return false
    if (row.anomalyType !== probe.anomalyType) return false
    const sameExact = probe.pointId !== null && row.pointId === probe.pointId
    const sameZone = row.buildingId === probe.buildingId && row.zoneId === probe.zoneId
    if (!sameExact && !sameZone) return false
    const gap = Math.abs(new Date(row.createdAt).getTime() - at)
    return gap <= window * 3_600_000
  })
}

export interface ReviewInput {
  issue: InspectionIssue
  action: ReviewAction
  /** 二级分类（处理结果）：必须是该一级出口允许的分类 */
  category: string
  note: string
  /** 关联既有对象时：关联的原问题 */
  duplicateOf?: string | null
  /** 关联既有对象时：关联的预警事件 */
  linkedEventId?: string | null
  /**
   * 本次审核后问题将拥有的照片总数（已有照片 + 本次随审核上传的）。
   * 「已当场处理」用它判断有没有现场照片 —— 判定必须看"本次操作后的状态"，不是操作前的库状态。
   */
  photoCount?: number
  /** 现场没法拍照时写的原因：与照片二者至少成立一条 */
  noPhotoReason?: string
  at: string
  by: string
  byRole: string
}

export interface ReviewOutcome {
  ok: boolean
  error: string
  /** 审核后的问题状态；出口与状态一一对应，不做自由跳转 */
  nextStatus: InspectionIssue['status']
  /** 是否需要后续动作：转维修要建工单、退回要通知报告人、复查要排任务 */
  followUp: 'work_order' | 'notify_reporter' | 'recheck_task' | 'link_duplicate' | 'close' | 'investigate'
}

/**
 * 六个一级出口 → 目标状态与后续动作。
 * 一级出口是给评委与管理者看的主干，二级分类只记录"具体是什么情况"，不改变流转。
 */
const REVIEW_FLOW: Record<ReviewAction, { status: InspectionIssue['status']; followUp: ReviewOutcome['followUp'] }> = {
  to_repair: { status: 'repairing', followUp: 'work_order' },
  to_investigate: { status: 'investigating', followUp: 'investigate' },
  need_evidence: { status: 'pending_review', followUp: 'notify_reporter' },
  link_object: { status: 'closed', followUp: 'link_duplicate' },
  recheck: { status: 'pending_recheck', followUp: 'recheck_task' },
  close_no_fault: { status: 'closed', followUp: 'close' },
}

/**
 * 出口 → 提交后的问题状态。
 * 审核结果预览必须取这一份，不能自己另写一套映射 —— 否则会出现"预览说 A、实际写 B"。
 */
export function nextStatusOf(action: ReviewAction): InspectionIssue['status'] {
  return REVIEW_FLOW[action].status
}

/** 审核判定：一级出口 + 二级分类各有前置条件，缺失即拦截并说明原因。 */
export function review(input: ReviewInput): ReviewOutcome {
  const flow = REVIEW_FLOW[input.action]
  if (flow === undefined) {
    return { ok: false, error: '未知的审核出口', nextStatus: input.issue.status, followUp: 'investigate' }
  }
  // 拦截时保持原状态：审核不通过不该动问题状态
  const deny = (error: string): ReviewOutcome => ({ ok: false, error, nextStatus: input.issue.status, followUp: flow.followUp })

  const allowed = REVIEW_CATEGORIES[input.action].some((row) => row.key === input.category)
  if (!allowed) return deny('请选择该出口下的处理结果（二级分类）')

  if (input.issue.status === 'closed') {
    return deny('该问题已关闭，如需继续处理请新建问题并关联原记录')
  }
  // 各出口都要求填写审核意见并留痕
  if (input.note.trim().length < REVIEW_NOTE_MIN_LENGTH) {
    return deny(`审核意见不少于 ${REVIEW_NOTE_MIN_LENGTH} 个字，否则事后无法解释当时的判断`)
  }
  if (input.action === 'need_evidence' && input.note.trim().length < NO_FAULT_MIN_LENGTH) {
    return deny(`退回补充要写明还缺什么（不少于 ${NO_FAULT_MIN_LENGTH} 个字），否则报告人不知道该补什么`)
  }
  if (input.action === 'link_object') {
    if (input.category === 'issue') {
      if ((input.duplicateOf ?? '').trim() === '') return deny('关联已有问题必须选择要关联的原记录')
      if (input.duplicateOf === input.issue.id) return deny('不能把问题关联到它自己')
    }
    if (input.category === 'event' && (input.linkedEventId ?? '').trim() === '') {
      return deny('关联既有预警事件必须选择要关联的事件')
    }
  }
  if (input.action === 'close_no_fault' && input.note.trim().length < NO_FAULT_MIN_LENGTH) {
    return deny(`关闭必须写明依据（不少于 ${NO_FAULT_MIN_LENGTH} 个字），否则等于没有结论`)
  }
  /*
   * 「已当场处理」是唯一一个"处理动作已经发生过"的关闭理由：只写一句说明还不够，
   * 要么留下现场照片，要么写明为什么拍不了照 —— 否则事后无法区分"真处理了"和"顺手关掉"。
   */
  if (
    input.action === 'close_no_fault' &&
    input.category === 'handled' &&
    (input.photoCount ?? 0) === 0 &&
    (input.noPhotoReason ?? '').trim().length < NO_FAULT_MIN_LENGTH
  ) {
    return deny(`“已当场处理”需要现场照片，或写明无法拍照的原因（不少于 ${NO_FAULT_MIN_LENGTH} 个字）`)
  }
  if (input.action === 'to_investigate' && input.note.trim().length < NO_FAULT_MIN_LENGTH) {
    return deny('转专业排查必须写明排查方向（不少于 10 个字）')
  }
  return { ok: true, error: '', nextStatus: flow.status, followUp: flow.followUp }
}

/** 复核意见最低字数：太短的"已看"等于没留痕。 */
export const REVIEW_NOTE_MIN_LENGTH = 4

/** 二级分类的中文名，供列表与时间线复用。 */
export function reviewCategoryLabel(action: ReviewAction | null, category: string): string {
  if (action === null || category === '') return ''
  return REVIEW_CATEGORIES[action].find((row) => row.key === category)?.name ?? category
}

/** 出口的中文名，供列表与时间线复用。 */
export function reviewActionLabel(action: ReviewAction | null): string {
  if (action === null) return '未审核'
  return REVIEW_ACTIONS.find((row) => row.key === action)?.name ?? action
}

/** 时间线追加：原始报告与审核动作都留痕，不覆盖。 */
export function withTimeline(
  issue: InspectionIssue,
  entry: { at: string; by: string; byRole: string; action: string; detail: string },
): InspectionIssue {
  return { ...issue, timeline: [...issue.timeline, entry] }
}
