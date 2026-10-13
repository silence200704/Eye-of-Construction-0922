import { draft, type AnswerDraft } from '../answers/shared'
import { buildStagePlan } from '../guide/stage'
import { buildLink } from '../actions'
import { completionGaps } from '../cases/query'
import type { AssistantSnapshot } from '../selectors'
import type { AskContext } from '../types'

export function answerProgress(snapshot: AssistantSnapshot, context: AskContext): AnswerDraft {
  const events = snapshot.events.filter(e => context.eventId ? e.id === context.eventId : e.pointId === context.pointId)
  if (events.length !== 1) return draft('请选定要查看办理进度的事件。',{ status: events.length ? 'need_choice' : 'not_found', candidates: events.map(e => ({ id: e.id, label: e.eventNo, detail: e.openedAt })) })
  const event = events[0]!
  const plan = buildStagePlan(snapshot,event.id)
  const issues = (snapshot.details?.issues ?? []).filter(i => i.eventId === event.id)
  const gaps = [...new Set([...plan.missing,...issues.flatMap(i => completionGaps(i,snapshot).map(gap => `${i.issueNo}：${gap}`))])]
  return draft(`${event.eventNo}：${plan.title}（业务主链 ${plan.step}/${plan.totalSteps}）。${plan.detail}`, {
    pointId: event.pointId, context: { pointId: event.pointId, eventId: event.id }, gaps: [...plan.gaps,...gaps],
    facts: [{ label: '仍缺办理项', value: gaps.length ? gaps.join('；') : '当前关联业务链已闭环', unit: '' }],
    links: [buildLink('event_report',event.id), ...plan.links], followups: ['还缺什么？','打开完整处置报告'],
    dataNotes: ['办理进度由当前事件、关联问题、工单及复查记录推导，普通提问不推进业务。'],
  })
}
