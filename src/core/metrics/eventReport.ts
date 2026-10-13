/**
 * 单事件处置报告（V1-E）：把"为何预警、谁处置、如何验收、为何关闭"汇到一页。
 *
 * 纯函数：只读传进来的行，不查库、不猜。
 * 三条口径：
 * ① 未接入真实通知渠道的站内提醒**只写已生成/已展示/已确认**，不写"已送达"；
 * ② 未确认、未关闭、未验收的环节如实写"未确认 / 尚未关闭"，**不留空** —— 空白会被读成"没问题"；
 * ③ 证据、措施、验收结论、关闭依据都是原始行的引用，不做二次加工。
 */
import { EVENT_LEVEL_LABEL } from '@/types/events'
import { statusLabelOf } from '@/api/contract/states'
import { ISSUE_SOURCES, REVIEW_ACTIONS, REVIEW_CATEGORIES } from '@/types/inspection'
import { formatDateTime } from '@/core/time'
import type { AlarmEvent, AlarmNotification } from '@/types/events'
import type { Device, Point } from '@/types/domain'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'

export interface ReportRow {
  label: string
  value: string
}

export interface EventReportSection {
  title: string
  /** 该环节要回答的问题（写在标题下，便于答辩时对照） */
  question: string
  rows: ReportRow[]
}

export interface EventReport {
  eventNo: string
  title: string
  /** 事件尚未闭环时置 false，页面顶部提示"事件尚未关闭" */
  closed: boolean
  sections: EventReportSection[]
  /** 合并时间线：事件、问题、工单三处按时间排序 */
  timeline: { at: string; by: string; action: string; detail: string }[]
}

function orNone(value: string): string {
  return value.trim() === '' ? '（未填写）' : value
}

function timeOrNone(value: string | null): string {
  return value === null ? '（无）' : formatDateTime(value)
}

/** 事件与证据：回答"为何预警"。 */
function evidenceSection(event: AlarmEvent, point: Point | null, device: Device | null): EventReportSection {
  const rows: ReportRow[] = [
    { label: '事件编号', value: event.eventNo },
    { label: '测点', value: point === null ? '（测点档案已删除）' : `${point.code} ${point.name}` },
    { label: '设备', value: device === null ? '（未绑定设备）' : `${device.code} ${device.name}` },
    { label: '触发规则', value: `${event.ruleCode}（单位 ${event.unit}）` },
    { label: '当前等级', value: EVENT_LEVEL_LABEL[event.level] },
    { label: '历史最高等级', value: EVENT_LEVEL_LABEL[event.peakLevel] },
    { label: '产生时间', value: formatDateTime(event.openedAt) },
    { label: '最近触发', value: `${formatDateTime(event.lastTriggerAt)}，触发值 ${event.lastTriggerValue}${event.unit}` },
    { label: '活跃证据', value: `${(event.evidences ?? []).length} 条` },
  ]
  // 早期写入的事件行没有 supersededEvidences 字段（V0.2 才加入），按空数组处理而不是崩在这
  const superseded = event.supersededEvidences ?? []
  ;(event.evidences ?? []).forEach((item, index) => {
    rows.push({
      label: `证据 ${index + 1}`,
      value: `${item.recordNo}（采样 ${formatDateTime(item.sampleTime)}）触发值 ${item.triggerValue}，基准 ${item.baselineValue ?? '（无）'}，规则版本 ${item.ruleVersion}；判定：${orNone(item.reason)}`,
    })
  })
  if (superseded.length > 0) {
    rows.push({ label: '已替代证据', value: `${superseded.length} 条（保留审计，不参与当前判定）` })
  }
  return { title: '一、事件与证据', question: '为何预警', rows }
}

/** 提醒与确认：回答"谁收到、谁确认"。 */
function notifySection(event: AlarmEvent, notifications: AlarmNotification[]): EventReportSection {
  const rows: ReportRow[] = [
    { label: '确认状态', value: event.acknowledgedAt === null ? '未确认' : `已确认：${timeOrNone(event.acknowledgedAt)}，${orNone(event.acknowledgedBy)}` },
    { label: '站内提醒', value: notifications.length === 0 ? '（无提醒记录）' : `${notifications.length} 条` },
  ]
  notifications.forEach((item, index) => {
    const states = [
      '已生成',
      `已展示 ${timeOrNone(item.presentedAt)}`,
      item.acknowledgedAt === null ? '未确认' : `已确认 ${timeOrNone(item.acknowledgedAt)} ${item.acknowledgedBy}`,
    ]
    const escalation =
      item.escalatedAt === null
        ? '未升级'
        : `已升级至 ${item.escalatedTo}（${item.escalationSource === 'demo' ? '演示模式模拟' : '按演示时限超时'}）`
    rows.push({
      label: `提醒 ${index + 1}`,
      value: `接收 ${item.target}（${item.channel}）：${states.join('；')}；${escalation}`,
    })
  })
  rows.push({
    label: '通知渠道说明',
    value: '演示只记录站内提醒的生成、展示与确认；未接入短信或推送渠道，因此不声称送达。',
  })
  return { title: '二、提醒与确认', question: '谁收到、谁确认', rows }
}

/** 问题与工单：回答"谁处置、如何验收"。 */
function disposalSection(issues: InspectionIssue[], orders: WorkOrder[]): EventReportSection {
  const rows: ReportRow[] = []
  if (issues.length === 0 && orders.length === 0) rows.push({ label: '处置记录', value: '（未转问题、也未建工单）' })
  issues.forEach((issue) => {
    rows.push({
      label: `问题 ${issue.issueNo}`,
      value: `来源 ${ISSUE_SOURCES.find(r => r.key === issue.source)?.name ?? issue.source}，异常类型 ${issue.anomalyType}；状态 ${statusLabelOf('issue',issue.status)}；审核出口 ${REVIEW_ACTIONS.find(r => r.key === issue.reviewAction)?.name ?? '未审核'}（${(issue.reviewAction ? REVIEW_CATEGORIES[issue.reviewAction] : []).find(r => r.key === issue.reviewCategory)?.name ?? orNone(issue.reviewCategory)}）；审核时间 ${timeOrNone(issue.reviewedAt)}`,
    })
    rows.push({ label: `问题 ${issue.issueNo} 描述`, value: orNone(issue.description) })
    ;(issue.rechecks ?? []).forEach((check,index) => {
      rows.push({ label: `问题 ${issue.issueNo} 复查 ${index + 1}`, value: `${check.subject}；负责人 ${check.owner}；登记 ${timeOrNone(check.at)}；结论 ${check.outcome ? statusLabelOf('recheckOutcome',check.outcome) : '尚未提交'}；${timeOrNone(check.outcomeAt)} ${check.outcomeBy}；${orNone(check.outcomeNote)}` })
    })
    if (!(issue.rechecks ?? []).some(check => check.outcome)) rows.push({ label: `问题 ${issue.issueNo} 闭环缺项`, value: '缺少复查结论' })
  })
  orders.forEach((order) => {
    rows.push({
      label: `工单 ${order.orderNo}`,
      value: `状态 ${statusLabelOf('workOrder',order.status)}；维修人 ${orNone(order.assignee)}；派工时间 ${timeOrNone(order.assignedAt)}；提交完工 ${timeOrNone(order.submittedAt)}；完工照片 ${order.photos.length} 张`,
    })
    rows.push({ label: `工单 ${order.orderNo} 措施`, value: orNone(order.measures) })
    rows.push({ label: `工单 ${order.orderNo} 材料`, value: orNone(order.materials) })
    order.reviews.forEach((review, index) => {
      rows.push({
        label: `验收 ${index + 1}`,
        value: `${review.action === 'verify' ? '验收通过' : '验收退回'}（${review.result === 'pass' ? '合格' : '不合格'}）：${timeOrNone(review.at)}，${review.by}（${review.byRole}）；意见：${orNone(review.note)}`,
      })
    })
  })
  return { title: '三、问题与工单', question: '谁处置、如何验收', rows }
}

/** 关闭依据：回答"为何关闭"。 */
function closeSection(event: AlarmEvent): EventReportSection {
  const rows: ReportRow[] = [
    { label: '关闭状态', value: event.closedAt === null ? '事件尚未关闭' : `已于 ${timeOrNone(event.closedAt)} 由 ${orNone(event.closedBy)} 关闭` },
    { label: '关闭依据', value: event.closedAt === null ? '（未填写）' : orNone(event.closeBasis) },
    { label: '备注', value: orNone(event.note) },
  ]
  return { title: '四、关闭依据', question: '为何关闭', rows }
}

/** 组装报告：四个环节 + 合并时间线，未关闭时 `closed` 为 false。 */
export function buildEventReport(input: {
  event: AlarmEvent
  point: Point | null
  device: Device | null
  notifications: AlarmNotification[]
  issues: InspectionIssue[]
  orders: WorkOrder[]
}): EventReport {
  const timeline = [
    ...(input.event.timeline ?? []).map((row) => ({ at: row.at, by: row.by, action: row.action, detail: row.detail })),
    ...input.issues.flatMap((issue) => (issue.timeline ?? []).map((row) => ({ at: row.at, by: row.by, action: `问题 ${issue.issueNo}：${row.action}`, detail: row.detail }))),
    ...input.orders.flatMap((order) => (order.timeline ?? []).map((row) => ({ at: row.at, by: row.by, action: `工单 ${order.orderNo}：${row.action}`, detail: row.detail }))),
  ].sort((a, b) => a.at.localeCompare(b.at))
  return {
    eventNo: input.event.eventNo,
    title: `${input.event.eventNo} 处置报告`,
    closed: input.event.closedAt !== null,
    sections: [
      evidenceSection(input.event, input.point, input.device),
      notifySection(input.event, input.notifications),
      disposalSection(input.issues, input.orders),
      closeSection(input.event),
    ],
    timeline,
  }
}
