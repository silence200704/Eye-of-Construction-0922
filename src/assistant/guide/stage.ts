/**
 * 同一事件处置阶段的只读推导（纯函数）。
 *
 * 关联口径固定为 `eventId → issue.eventId → workOrder.issueId`，全部取自 `buildSnapshot()`
 * 的真实投影；**不复制工单状态机，也不复制事件关闭判定**——只按状态字段读出现阶段。
 * 判定"能不能关闭"始终由事件详情里的核心校验负责，小瞳只说明"按事件详情的关闭条件办理"。
 *
 * 两条纪律：
 * 1. 断链或多条候选时**报原因并要求选择**，不替人挑一个编号；
 * 2. 步骤号与事件详情页的「现场处置流程 n/7 步」同一梯子（预警→问题→派工→维修→验收→复查→关闭），
 *    避免同一件事在界面两处显示成两个进度。
 */
import type { AlarmEvent } from '@/types/events'
import type { IssueStatus, WorkOrderStatus } from '@/types/inspection'
import { buildLink } from '../actions'
import { associateEventChain, issueCandidate, orderCandidate } from './chain'
import { nfcGuideOf } from './nfc'
import type { NfcGuide, TaskRef } from './nfc'
import type { EventChain, StageCandidate } from './chain'
import type { AssistantSnapshot } from '../selectors'
import type { IssueRef, WorkOrderRef } from '../selectors/snapshot'
import type { AskLink } from '../types'

export type GuideStage =
  | 'prepare'
  | 'event_pending'
  | 'issue_missing'
  | 'issue_review'
  | 'issue_investigating'
  | 'work_order_dispatch'
  | 'work_order_repair'
  | 'work_order_verify'
  | 'issue_recheck'
  | 'issue_observing'
  | 'issue_closed'
  | 'event_closed'
  | 'chain_broken'
  | 'stale'

/** 与事件详情页同一条梯子：预警 → 问题 → 派工 → 维修 → 验收 → 复查 → 关闭。 */
export const STAGE_TOTAL_STEPS = 7

export interface GuideStagePlan {
  stage: GuideStage
  step: number
  totalSteps: number
  title: string
  detail: string
  /** 下一责任角色；空串 = 当前没有待办角色 */
  nextRole: string
  /** 仍缺的动作（一句话一条，按顺序就是推荐动作顺序） */
  missing: string[]
  eventNo: string
  issueNo: string
  orderNo: string
  /** 断链或多候选时需要人选定；非空时界面只列候选，不自动打开任何一个 */
  candidates: StageCandidate[]
  /** 主按钮（原业务表单深链）；空数组表示这一步没有可打开的页面 */
  links: AskLink[]
  /** 演示导览入口（影像对比、现场任务页）：只把人带到现有页面，不在导览里写数据 */
  demoLinks: AskLink[]
  /** 数据口径与链路说明，界面原样展示 */
  gaps: string[]
  /** 归属说明：未能直接核实的地方（例如工单没登记事件号），不算断链但要如实展示 */
  verifyNotes: string[]
  /** 模拟 NFC 导览：去哪条任务、哪个点位、按什么顺序；缺数据时要求先确认再载入场景 */
  nfc: NfcGuide
}

/** 只读关联结果：事件、它名下的问题、这些问题名下的工单，以及断链说明。 */
export { associateEventChain, issueCandidate, orderCandidate } from './chain'
export type { EventChain, StageCandidate } from './chain'

const ISSUE_STAGE_TITLE: Partial<Record<IssueStatus, string>> = {
  pending_review: '待审核',
  investigating: '排查中',
  repairing: '处理中',
  pending_recheck: '待复查',
  observing: '观察中',
  closed: '已关闭',
}

/** 候选按钮由 `chain.ts` 生成（只带白名单深链，不替人打开）。 */

function planOf(input: Partial<GuideStagePlan> & { stage: GuideStage; step: number; title: string; detail: string }): GuideStagePlan {
  return {
    nextRole: '',
    missing: [],
    eventNo: '',
    issueNo: '',
    orderNo: '',
    candidates: [],
    links: [],
    demoLinks: [],
    gaps: [],
    verifyNotes: [],
    nfc: nfcGuideOf({ tasks: [], points: [] }, null),
    ...input,
    totalSteps: STAGE_TOTAL_STEPS,
  }
}

/** 事件已关闭：只说明"已关闭"与仍可能存在的独立待办，不判定能否再次关闭。 */
function closedPlan(chain: EventChain, eventNo: string): GuideStagePlan {
  const openIssues = chain.issues.filter((row) => row.status !== 'closed')
  const missing = openIssues.map(
    (row) => `问题 ${row.issueNo} 仍是「${ISSUE_STAGE_TITLE[row.status] ?? row.status}」，需按原入口继续办理。`,
  )
  const openOrders = chain.orders.filter((row) => row.status !== 'verified')
  if (openOrders.length > 0) {
    missing.push(`工单 ${openOrders.map((row) => row.orderNo).join('、')} 尚未验收通过。`)
  }
  return planOf({
    stage: chain.event?.status === 'closed' ? 'event_closed' : 'issue_closed',
    step: 7,
    title: chain.event?.status === 'closed' ? '事件已关闭' : '问题已关闭',
    detail:
      chain.event?.status === 'closed'
        ? `${eventNo} 已关闭，整改与复查记录保留可查。`
        : `问题已关闭，但关联事件 ${eventNo} 仍开放：能否关闭以事件详情里的关闭条件与处置依据为准。`,
    nextRole: openIssues.length === 0 ? '' : '学校安全管理人员',
    missing,
    eventNo,
    // 已关闭事件的关联对象逐个列出编号，不把数组第一项说成唯一关联
    issueNo: chain.issues.map((row) => row.issueNo).join('、'),
    orderNo: chain.orders.map((row) => row.orderNo).join('、'),
    links: [buildLink('event_detail', chain.event?.id ?? '')],
    gaps: chain.gaps,
    verifyNotes: chain.weak,
  })
}

/** 链路待人工核对：只说明原因和可核对的页面，不给任何"下一步动作"。 */
function brokenPlan(
  chain: EventChain,
  input: { title: string; detail: string; step: number; candidates: StageCandidate[]; refs: { issueNo: string; orderNo: string } },
): GuideStagePlan {
  const eventId = chain.event?.id ?? ''
  return planOf({
    stage: 'chain_broken',
    step: input.step,
    title: input.title,
    detail: input.detail,
    nextRole: '学校安全管理人员',
    missing: ['到下面的原业务页面核对后再继续'],
    eventNo: chain.event?.eventNo ?? '',
    issueNo: input.refs.issueNo,
    orderNo: input.refs.orderNo,
    candidates: input.candidates,
    links: eventId === '' ? [] : [buildLink('event_detail', eventId)],
    gaps: chain.gaps,
    verifyNotes: chain.weak,
  })
}

/** 单一问题的出口：按问题状态与它名下工单状态读出真实阶段。 */
function planOfIssue(chain: EventChain, issue: IssueRef, eventNo: string): GuideStagePlan {
  const base = { eventNo, issueNo: issue.issueNo, gaps: chain.gaps, verifyNotes: chain.weak }
  if (issue.status === 'closed') return closedPlan(chain, eventNo)
  if (issue.status === 'pending_review' || issue.status === 'investigating') {
    const investigating = issue.status === 'investigating'
    return planOf({
      ...base,
      stage: investigating ? 'issue_investigating' : 'issue_review',
      step: 2,
      title: ISSUE_STAGE_TITLE[issue.status] ?? '问题处理中',
      detail: investigating
        ? `${issue.issueNo} 已转专业排查，等待排查结论与后续处置安排。`
        : `${issue.issueNo} 等待审核：六个出口里选一个，转维修才会生成工单。`,
      nextRole: investigating ? '专业排查单位（安全管理人员督办）' : '学校安全管理人员',
      missing: [investigating ? '提交排查结论' : '选择审核出口并填写审核意见'],
      links: [buildLink('issue_detail', issue.id)],
    })
  }
  if (issue.status === 'pending_recheck' || issue.status === 'observing') {
    const orderNo = chain.orders[0]?.orderNo ?? ''
    const round = issue.rechecks.openRound
    const missing = round === null
      ? [issue.rechecks.count === 0 ? '登记复查事项、责任人与目标日期' : '给出本轮复查结论']
      : [`按目标日期给出本轮复查结论（责任人 ${round.owner}，目标日期 ${round.dueDate}）`]
    return planOf({
      ...base,
      stage: issue.status === 'observing' ? 'issue_observing' : 'issue_recheck',
      step: 6,
      title: ISSUE_STAGE_TITLE[issue.status] ?? '待复查',
      detail:
        `${issue.issueNo} 已进入${ISSUE_STAGE_TITLE[issue.status] ?? '待复查'}：复查结论由人明确给出，系统不会自动关闭。` +
        `${round === null ? '' : ` 当前这一轮：${round.subject}。`}`,
      nextRole: round === null ? '学校安全管理人员' : `学校安全管理人员（责任人 ${round.owner} 执行）`,
      missing,
      orderNo,
      links: [buildLink('issue_detail', issue.id)],
    })
  }
  // 处理中：全部结论落在它名下的工单上
  if (chain.orders.length === 0) {
    return planOf({
      ...base,
      stage: 'chain_broken',
      step: 3,
      title: '链路不完整：问题名下没有工单',
      detail: `${issue.issueNo} 状态是「处理中」，但当前数据集里找不到它名下的工单。请打开问题详情核对，不要按推测继续。`,
      nextRole: '学校安全管理人员',
      missing: ['到问题详情核对工单记录'],
      links: [buildLink('issue_detail', issue.id)],
    })
  }
  if (chain.orders.length > 1) {
    return planOf({
      ...base,
      stage: 'chain_broken',
      step: 4,
      title: '多张工单需要选定',
      detail: `${issue.issueNo} 名下有 ${chain.orders.length} 张工单，无法确定要讲解哪一张；请打开其中一张继续。`,
      nextRole: '学校安全管理人员',
      missing: ['选定要查看的工单'],
      candidates: chain.orders.map(orderCandidate),
      links: [buildLink('issue_detail', issue.id)],
    })
  }
  return planOfWorkOrder(chain, issue, chain.orders[0])
}

const ORDER_DETAIL: Record<WorkOrderStatus, { title: string; detail: string; role: string; missing: string }> = {
  created: {
    title: '工单待派工',
    detail: '工单已从审核转出，还没有指定维修人；派工后现场才会有人接单。',
    role: '学校安全管理人员',
    missing: '指定维修人与期限后派工',
  },
  assigned: {
    title: '已派工待接单',
    detail: '维修人已指定，等待被派工人接单；物业值班可代接，但要写明代接原因。',
    role: '被派工的人（维修人员 / 物业值班）',
    missing: '接单处理',
  },
  repairing: {
    title: '维修处理中',
    detail: '已接单，等待提交维修措施、使用材料与完工照片。',
    role: '维修人员',
    missing: '提交待验收（措施必填）',
  },
  returned: {
    title: '验收退回待返工',
    detail: '上一轮验收未通过，需要按退回原因返工后重新提交。',
    role: '维修人员',
    missing: '返工后重新提交待验收',
  },
  submitted: {
    title: '待验收',
    detail: '维修已提交，等待验收结论；验收通过只会把问题推进到待复查，不会自动关闭问题或事件。',
    role: '学校安全管理人员',
    missing: '核对措施与照片后给出验收结论',
  },
  verified: {
    title: '验收已通过',
    detail: '工单已验收通过，问题进入待复查；还需要人登记复查事项与目标日期。',
    role: '学校安全管理人员（复查责任人执行）',
    missing: '登记复查并给出复查结论',
  },
}

function planOfWorkOrder(chain: EventChain, issue: IssueRef, order: WorkOrderRef): GuideStagePlan {
  const stage = stageOfOrder(order.status)
  const info = ORDER_DETAIL[order.status]
  return planOf({
    stage,
    step: stepOfOrder(order.status),
    title: info.title,
    detail: `${order.orderNo}：${info.detail}`,
    nextRole: info.role,
    missing: [info.missing],
    eventNo: chain.event?.eventNo ?? '',
    issueNo: issue.issueNo,
    orderNo: order.orderNo,
    links: [buildLink('workorder_detail', order.id), buildLink('issue_detail', issue.id)],
    gaps: chain.gaps,
    verifyNotes: chain.weak,
  })
}

function stageOfOrder(status: WorkOrderStatus): GuideStage {
  if (status === 'created') return 'work_order_dispatch'
  if (status === 'submitted') return 'work_order_verify'
  return 'work_order_repair'
}

function stepOfOrder(status: WorkOrderStatus): number {
  if (status === 'created') return 3
  if (status === 'submitted') return 5
  return 4
}

function planOfEvent(chain: EventChain, event: AlarmEvent): GuideStagePlan {
  const eventNo = event.eventNo
  /*
   * 顺序刻意固定：**先消歧、再判链路、最后才按状态给阶段**。
   * 事件已关闭也必须先过这几道 —— 否则"已关闭"会绕过多问题/多工单消歧，
   * 把数组第一项当成唯一关联对象。
   */
  if (chain.issues.length > 1) {
    return brokenPlan(chain, {
      title: '多条关联问题需要选定',
      detail: `${eventNo} 关联了 ${chain.issues.length} 条问题，无法确定要讲解哪一条；请打开其中一条继续。`,
      step: 2,
      candidates: chain.issues.map(issueCandidate),
      // 多候选时不报工单号：任何一条都可能不是要讲的那条
      refs: { issueNo: chain.issues.map((row) => row.issueNo).join('、'), orderNo: '' },
    })
  }
  if (chain.issues.length === 1 && chain.orders.length > 1) {
    return brokenPlan(chain, {
      title: '多张工单需要选定',
      detail: `问题 ${chain.issues[0].issueNo} 名下有 ${chain.orders.length} 张工单，无法确定要讲解哪一张；请打开其中一张继续。`,
      step: 4,
      candidates: chain.orders.map(orderCandidate),
      refs: { issueNo: chain.issues[0].issueNo, orderNo: '' },
    })
  }
  if (chain.gaps.length > 0) {
    return brokenPlan(chain, {
      title: '链路待人工核对',
      detail: `${eventNo} 的关联对象双向对不上：${chain.gaps[0]} 其余阶段一律不展示，请先到下面的原业务页面核对。`,
      step: 3,
      candidates: chain.orders.length > 1 ? chain.orders.map(orderCandidate) : [],
      refs: {
        issueNo: chain.issues.map((row) => row.issueNo).join('、'),
        orderNo: chain.orders.map((row) => row.orderNo).join('、'),
      },
    })
  }
  if (event.status === 'closed') return closedPlan(chain, eventNo)
  if (chain.issues.length === 0) {
    const pending = event.status === 'pending'
    return planOf({
      stage: pending ? 'event_pending' : 'issue_missing',
      step: pending ? 1 : 2,
      title: pending ? '核对红色预警' : '等待转问题',
      detail: pending
        ? `${eventNo} 当前「待确认」，有 ${event.evidences.length} 条证据；先看证据链，再由安全管理人员确认。`
        : `${eventNo} 已确认，但还没有关联问题；预警要经「转问题」才进入处置。`,
      nextRole: '学校安全管理人员',
      missing: [pending ? '核对证据链后确认事件' : '把预警转成问题'],
      eventNo,
      links: [buildLink('event_detail', event.id)],
      gaps: chain.gaps,
    verifyNotes: chain.weak,
    })
  }
  return planOfIssue(chain, chain.issues[0], eventNo)
}

/** 巡检导览的输入：只要任务与测点档案两项。 */
function nfcInputOf(snapshot: AssistantSnapshot): { tasks: TaskRef[]; points: { id: string; code: string; name: string }[] } {
  return { tasks: snapshot.tasks, points: snapshot.points.map((row) => ({ id: row.id, code: row.code, name: row.name })) }
}

/**
 * 演示导览入口（D 组）：影像对比与现场任务页。
 * 只给现有页面的深链与"进页后点什么"的说明；**不在导览里写任何演示数据**——
 * 需要补演示照片或巡检场景时，仍在原页面点既有的一键入口。
 */
function demoLinksOf(snapshot: AssistantSnapshot, event: AlarmEvent | null): AskLink[] {
  const out: AskLink[] = []
  const pointId = event?.pointId ?? ''
  if (pointId !== '' && snapshot.points.some((row) => row.id === pointId)) {
    out.push(buildLink('media_page', pointId))
  }
  out.push(buildLink('inspection_page'))
  return out
}

/**
 * 阶段卡：每次调用都从当前快照重算，页面状态变化后不会继续展示旧阶段。
 * `eventId` 为空或对象已不存在时给准备/失效卡，绝不凭空编一个事件编号。
 *
 * 顺序：先消歧与链路核对（`planOfEvent` 内部），再按状态给阶段；所有返回都附带演示导览入口。
 */
export function buildStagePlan(snapshot: AssistantSnapshot, eventId: string): GuideStagePlan {
  if (eventId === '') {
    return planOf({
      stage: 'prepare',
      step: 1,
      title: '准备演示预警',
      detail: '当前尚未选定事件。确认后才会补入本地演示记录；不会预建问题或工单。',
      demoLinks: demoLinksOf(snapshot, null),
      nfc: nfcGuideOf(nfcInputOf(snapshot), null),
    })
  }
  const chain = associateEventChain(snapshot, eventId)
  if (chain.event === null) {
    return planOf({
      stage: 'stale',
      step: 1,
      title: '事件已失效',
      detail: '当前数据集找不到上一轮事件，请重新选定或重新载入演示场景。',
      demoLinks: demoLinksOf(snapshot, null),
      nfc: nfcGuideOf(snapshot, null),
      gaps: chain.gaps,
    verifyNotes: chain.weak,
    })
  }
  const plan = planOfEvent(chain, chain.event)
  return { ...plan, demoLinks: demoLinksOf(snapshot, chain.event), nfc: nfcGuideOf(nfcInputOf(snapshot), chain.event) }
}

/** 粗粒度相位：给界面做样式与"是否可准备"判断，语义与新阶段一一对应。 */
export function phaseOfStage(stage: GuideStage): 'prepare' | 'inspect' | 'handling' | 'closed' | 'stale' {
  if (stage === 'prepare') return 'prepare'
  if (stage === 'stale') return 'stale'
  if (stage === 'event_pending') return 'inspect'
  if (stage === 'event_closed' || stage === 'issue_closed') return 'closed'
  return 'handling'
}
