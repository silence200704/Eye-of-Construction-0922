/** 演示导览只读计划。步骤来自当前快照，绝不把计划当作已完成的业务状态。 */
import type { AlarmEvent } from '@/types/events'
import { buildLink } from '../actions'
import { answerEventReason } from '../answers/event'
import { draft, type AnswerDraft } from '../answers/shared'
import { findEventByNo, openEventsByLevel, type AssistantSnapshot } from '../selectors'
import type { AskContext, AskLink } from '../types'
import { buildStagePlan, phaseOfStage } from './stage'
import type { NfcGuide } from './nfc'
import type { GuideStage, StageCandidate } from './stage'

type Selection =
  | { kind: 'event'; event: AlarmEvent; reason: string }
  | { kind: 'none' | 'multiple' | 'missing'; reason: string; canPrepare: boolean }

/** 显式编号优先；上下文对象失效时直接报错，不悄悄换成别的红色事件。 */
export function selectGuideEvent(snapshot: AssistantSnapshot, context: AskContext, eventNo: string | null, pointCode: string | null): Selection {
  if (eventNo !== null) {
    const event = findEventByNo(snapshot.events, eventNo)
    return event === null
      ? { kind: 'missing', reason: `当前数据集没有事件 ${eventNo}；请到预警中心重新选定。`, canPrepare: false }
      : { kind: 'event', event, reason: `按事件编号 ${event.eventNo} 精确匹配` }
  }
  if (pointCode !== null) {
    const point = snapshot.points.find((row) => row.code.toUpperCase() === pointCode.toUpperCase() && !row.archived)
    if (point === undefined) return { kind: 'missing', reason: `当前档案没有测点 ${pointCode}。`, canPrepare: false }
    return selectForPoint(snapshot, point.id, point.code)
  }
  if (context.eventId !== undefined) {
    const event = snapshot.events.find((row) => row.id === context.eventId)
    return event === undefined
      ? { kind: 'missing', reason: '上一轮选定的事件已不在当前数据集，请重新选择。', canPrepare: false }
      : { kind: 'event', event, reason: '沿用当前明确选定的事件' }
  }
  if (context.pointId !== undefined) {
    const point = snapshot.points.find((row) => row.id === context.pointId && !row.archived)
    if (point === undefined) return { kind: 'missing', reason: '上一轮选定的测点已不在当前档案，请重新选择。', canPrepare: false }
    return selectForPoint(snapshot, point.id, point.code)
  }
  const reds = openEventsByLevel(snapshot.events, 'red')
  if (reds.length === 1) return { kind: 'event', event: reds[0], reason: '当前唯一的未关闭红色事件' }
  if (reds.length > 1) return { kind: 'multiple', reason: `当前有 ${reds.length} 条未关闭红色事件，请在预警中心选定一条再点「问小瞳」。`, canPrepare: false }
  const history = snapshot.events.filter((row) => row.peakLevel === 'red' && row.status === 'closed')
  if (history.length === 1) return { kind: 'event', event: history[0], reason: '当前唯一的历史红色事件（仅回看，不再创建）' }
  if (history.length > 1) return { kind: 'multiple', reason: `当前有 ${history.length} 条已关闭红色事件，请在预警中心选定一条回看。`, canPrepare: false }
  return { kind: 'none', reason: '当前没有未关闭的红色事件；临时数据请到系统设置一键载入全链演示数据。', canPrepare: true }
}

function selectForPoint(snapshot: AssistantSnapshot, pointId: string, code: string): Selection {
  const rows = snapshot.events.filter((row) => row.pointId === pointId && row.status !== 'closed')
  if (rows.length === 1) return { kind: 'event', event: rows[0], reason: `当前测点 ${code} 的唯一未关闭事件` }
  if (rows.length > 1) return { kind: 'multiple', reason: `${code} 有 ${rows.length} 条未关闭事件，请到预警中心选定一条。`, canPrepare: false }
  return { kind: 'none', reason: `${code} 当前没有未关闭事件；导览不会凭空把它说成红色预警。`, canPrepare: false }
}

export function answerGuide(snapshot: AssistantSnapshot, selection: Selection): AnswerDraft {
  if (selection.kind !== 'event') {
    return draft(selection.reason, {
      status: 'not_found',
      guide: { eventId: null, canPrepare: selection.canPrepare },
      gaps: ['没有选定真实事件时，导览不会生成假的事件编号或声称处置已完成。'],
      links: [buildLink('alarm_queue'), ...(selection.canPrepare ? [buildLink('settings')] : [])],
      dataNotes: ['导览只读；临时数据只有系统设置里的一个载入入口。'],
    })
  }
  const explained = answerEventReason({ snapshot, event: selection.event, matchNote: selection.reason })
  return {
    ...explained,
    guide: { eventId: selection.event.id, canPrepare: false },
    conclusion: `带你看 ${selection.event.eventNo} 的处置流程。${selection.event.status === 'closed' ? `这是已关闭的历史${selection.event.peakLevel === 'red' ? '红色' : ''}事件，仅供回看。` : ''}${explained.conclusion}`,
    dataNotes: [...(explained.dataNotes ?? []), '下一步以事件当前状态为准；小瞳不会替人确认、派工、验收或关闭。'],
  }
}

export interface GuidePlan {
  phase: 'prepare' | 'inspect' | 'handling' | 'closed' | 'stale'
  step: number
  title: string
  detail: string
  eventNo: string
  link: AskLink | null
  canPrepare: boolean
  /** 真实处置阶段（见 stage.ts）：待确认 / 问题待审核 / 工单待派工 / 维修中 / 待验收 / 待复查 / 关闭… */
  stage: GuideStage
  /** 步骤总数与事件详情页的「现场处置流程 n/7 步」同一梯子 */
  totalSteps: number
  /** 下一责任角色；空串表示当前没有待办角色 */
  nextRole: string
  /** 仍缺的动作，按推荐顺序 */
  missing: string[]
  issueNo: string
  orderNo: string
  /** 断链或多候选时必须由人选定，界面只列候选 */
  candidates: StageCandidate[]
  /** 除主按钮外的其它只读入口（问题 / 工单原表单） */
  extraLinks: AskLink[]
  /** 演示导览入口（影像对比、现场任务页）：只把人带到现有页面，不在导览里写数据 */
  demoLinks: AskLink[]
  /** 链路与数据口径说明 */
  gaps: string[]
  /** 归属说明：未能直接核实的地方（不算断链，但要如实展示） */
  verifyNotes: string[]
  /** 模拟 NFC 导览：任务、点位与顺序 */
  nfc: NfcGuide
}

/**
 * 导览卡每次从当前快照推导，页面状态变化后不会继续展示旧阶段。
 *
 * 阶段与链路全部来自 `stage.ts` 的只读关联（事件→问题→工单）；这里只把它翻译成卡片字段，
 * 不复制状态机、也不判断"能不能关闭"。
 */
export function buildGuidePlan(snapshot: AssistantSnapshot, eventId: string): GuidePlan {
  const plan = buildStagePlan(snapshot, eventId)
  const primary = plan.links.length > 0 ? plan.links[0] : null
  const extras = plan.links.slice(1)
  return {
    phase: phaseOfStage(plan.stage),
    step: plan.step,
    title: plan.title,
    detail: plan.detail,
    eventNo: plan.eventNo,
    link: primary,
    canPrepare: plan.stage === 'prepare',
    stage: plan.stage,
    totalSteps: plan.totalSteps,
    nextRole: plan.nextRole,
    missing: plan.missing,
    issueNo: plan.issueNo,
    orderNo: plan.orderNo,
    candidates: plan.candidates,
    extraLinks: extras,
    demoLinks: plan.demoLinks,
    gaps: plan.gaps,
    verifyNotes: plan.verifyNotes,
    nfc: plan.nfc,
  }
}
