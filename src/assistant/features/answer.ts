import { draft, type AnswerDraft } from '../answers/shared'
import { buildLink } from '../actions'
import { rangeForQuestion } from '@/core/chart/range'
import { answerCompare } from '../compare/query'
import { replayNodes } from '../replay/query'
import { findCases } from '../cases/query'
import { simulateThresholds } from '../simulate/query'
import { answerProgress } from './progress'
import type { AskContext, AskIntent } from '../types'
import type { AssistantSnapshot } from '../selectors'

export function answerFeature(input: { snapshot: AssistantSnapshot; question: string; context: AskContext; intent: AskIntent }): AnswerDraft | null {
  const { snapshot, question, context, intent } = input
  if (intent === 'demo_guide' && /办理到哪|还缺什么|打开完整处置报告/.test(question)) return answerProgress(snapshot,context)
  if (intent === 'point_compare') return answerCompare(snapshot,question,context)
  if (!['event_replay','case_search','rule_simulate'].includes(intent)) return null
  const code = snapshot.points.find(p => question.toUpperCase().includes(p.code.toUpperCase()))
  const eventNo = snapshot.events.find(e => question.toUpperCase().includes(e.eventNo.toUpperCase()))
  const pointId = code?.id ?? eventNo?.pointId ?? context.pointId ?? snapshot.events.find(e => e.id === context.eventId)?.pointId
  const selected = eventNo ?? snapshot.events.find(e => e.id === context.eventId && (!code || e.pointId === code.id))
  const events = selected ? [selected] : snapshot.events.filter(e => e.pointId === pointId)
  if (intent === 'event_replay') {
    if (events.length !== 1) return draft(events.length ? '这个测点有多次事件，请选择要回放的事件。' : '没有可回放的真实事件记录。', {
      status: events.length ? 'need_choice' : 'not_found',
      candidates: events.map(e => ({ id: e.id, label: e.eventNo, detail: e.openedAt })),
    })
    const event = events[0]!
    const nodes = replayNodes(event,snapshot.details?.issues ?? [])
    const node = nodes.find(n => n.id === context.replayNode) ?? nodes.find(n => /红色/.test(n.title) && n.id.startsWith('upgrade'))
    return draft(`${event.eventNo} 有 ${nodes.length} 个可核实历史节点。${/什么时候|当时/.test(question) && node ? `${node.title}：${node.at}，依据 ${node.recordNo ?? '原办理记录'}。` : ''}`, {
      pointId: event.pointId, context: { pointId: event.pointId, eventId: event.id, replayNode: node?.id },
      previews: [{ kind: 'event_replay', eventId: event.id, nodes }],
      evidence: nodes.filter(n => n.recordNo).map(n => ({ kind: 'event', ref: n.recordNo!, id: event.id, detail: `${n.title}；${n.detail}` })),
      links: [buildLink('event_detail',event.id)], followups: ['什么时候变成红色？','当时依据哪条记录？','看当前状态'],
      dataNotes: ['节点引用原始证据与办理记录；无记录的旧状态不推测。'],
    })
  }
  if (!pointId) return draft('请指定测点或当前事件。', { status: 'need_choice', candidates: snapshot.points.filter(p => !p.archived).map(p => ({ id: p.id, label: p.code, detail: p.name })) })
  if (intent === 'case_search') return casesAnswer(snapshot,question,{ ...context, pointId },selected?.id)
  return simulationAnswer(snapshot,question,{ ...context, pointId })
}

function casesAnswer(snapshot: AssistantSnapshot, question: string, context: AskContext, eventId?: string): AnswerDraft {
  const current = (snapshot.details?.issues ?? []).find(i => i.eventId === (eventId ?? context.eventId))
  const matches = findCases(snapshot,{ pointId: context.pointId!, issueId: current?.id })
  const number = /第([一二三四五1-5])个/.exec(question)?.[1]
  const index = number ? '一二三四五'.indexOf(number) >= 0 ? '一二三四五'.indexOf(number) : Number(number)-1 : -1
  const selectedId = index >= 0 ? context.caseIds?.[index] : undefined
  const selected = selectedId ? matches.rows.find(r => r.issueId === selectedId) : undefined
  if (number && !selected) return draft('上一轮案例清单已失效或没有这一项，请重新检索。',{ status: 'not_found' })
  const rows = selected ? [selected] : matches.rows
  return draft(matches.total ? `找到 ${matches.total} 条匹配案例（已排除当前问题），本次展示 ${rows.length} 条；完整办结 ${rows.filter(r => r.complete).length} 条。` : '当前没有满足匹配条件的历史案例。', {
    status: matches.total ? 'answered' : 'not_found', pointId: context.pointId,
    previews: [{ kind: 'case_search', total: matches.total, rows }],
    context: { ...context, caseIds: selected ? context.caseIds : rows.map(r => r.issueId) },
    links: rows.map(r => r.eventId ? buildLink('event_report',r.eventId) : buildLink('issue_detail',r.issueId)),
    followups: matches.total ? ['它们匹配了哪些条件？','历史案例怎么处理的？', ...(rows.length > 1 ? ['打开第二个历史案例'] : [])] : [],
    dataNotes: ['完整办结须问题关闭、有复查结论、所有关联工单验收、有事件时事件关闭。'],
  })
}

function simulationAnswer(snapshot: AssistantSnapshot, question: string, context: AskContext): AnswerDraft {
  if (/取消试算/.test(question)) return draft('试算已取消，没有保存任何候选规则。',{ pointId: context.pointId, context: { pointId: context.pointId, eventId: context.eventId, range: context.range } })
  const rule = snapshot.ruleAt(context.pointId!,snapshot.now)
  if (!rule?.thresholds || rule.metric === 'environment') return draft('此测点没有可用于数值阈值试算的规则。',{ status: 'unsupported' })
  const thresholds = { ...(context.simulation ?? rule.thresholds) }
  let supplied = Boolean(context.simulation)
  for (const [name,key] of [['黄色','yellow'],['橙色','orange'],['红色','red']] as const) {
    const value = new RegExp(`${name}(?:阈值)?(?:改为|设为|为|是|=|：)?(-?\\d+(?:\\.\\d+)?)`).exec(question.replace(/\s/g,''))
    if (value) { thresholds[key] = Number(value[1]); supplied = true }
  }
  if (!supplied) return draft('请给出候选阈值，例如“试算黄色阈值改为0.15毫米，最近7天哪些记录改变等级”。',{ status: 'unsupported' })
  const range = rangeForQuestion(question,snapshot.now,context.range)
  const preview = simulateThresholds({ snapshot, pointId: context.pointId!, range, thresholds })
  const changed = preview.rows.filter(r => r.changed).length
  return draft(`${range.label}，${preview.rows.length} 条范围内记录中 ${changed} 条判定发生变化；候选阈值未保存。`, {
    pointId: context.pointId, context: { pointId: context.pointId, eventId: context.eventId, range, simulation: thresholds }, previews: [{ ...preview, rows: /只看.*变化/.test(question) ? preview.rows.filter(r => r.changed) : preview.rows }],
    facts: [{ label: '等级变化', value: String(changed), unit: '条' }, { label: '候选黄／橙／红', value: `${thresholds.yellow}／${thresholds.orange}／${thresholds.red}`, unit: rule.unit }],
    followups: ['只看等级变化的记录','取消试算'], dataNotes: ['范围外历史仅供持续异常与恢复计算；试算不生成事件、工单或审计日志。'],
  })
}
