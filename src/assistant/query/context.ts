import { extractEntities, hasPointClue, normalizeQuestion } from '../parse'
import { draft, type AnswerDraft } from '../answers/shared'
import { resolvePoint, toCandidates } from '../resolve'
import type { AssistantSnapshot } from '../selectors'
import type { AskCandidate, AskContext } from '../types'
import { featureIntent } from '../features/intent'

/** 页面对象与上轮对象分开存；显式编号总由正常解析处理。 */
export function queryContext(input: { question: string; page: AskContext; previous: AskContext; snapshot: AssistantSnapshot }): AskContext | AnswerDraft {
  const { question, page, previous, snapshot } = input
  if (featureIntent(question,previous)) return { ...previous, ...(!previous.pointId && !previous.eventId ? page : {}) }
  if (previous.pointIds?.length === 2 && /它|这一个/.test(question) && !previous.chosen) return draft('这里有两个比较对象，请选择这句问题指的是哪一个。', {
    status: 'need_choice', candidates: toCandidates(snapshot.points.filter(p => previous.pointIds!.includes(p.id))),
  })
  if (previous.pointIds?.length && /只看第一个/.test(question)) return { pointId: previous.pointIds[0] }
  const entities = extractEntities(normalizeQuestion(question))
  if (entities.eventNo !== null) {
    const event = snapshot.events.find((e) => e.eventNo.toUpperCase() === entities.eventNo?.toUpperCase())
    return event ? { eventId: event.id } : {}
  }
  if (hasPointClue(entities)) {
    const resolved = resolvePoint({ question: normalizeQuestion(question).compact, entities, points: snapshot.points, buildings: snapshot.buildings })
    if (resolved.status === 'exact' || resolved.status === 'unique') return { pointId: resolved.points[0].id }
    return previous.chosen ? previous : {}
  }
  if (/刚才|上一|上面/.test(question)) return previous
  if (/当前选中|页面选中|这里选/.test(question)) return page
  const idOf = (c: AskContext): string | undefined => c.pointId ?? snapshot.events.find((e) => e.id === c.eventId)?.pointId
  const current = idOf(page)
  const old = idOf(previous)
  if (previous.chosen === true) return previous
  if (page.eventId && previous.eventId && page.eventId !== previous.eventId && /这条|这个事件|为什么|处置|处理/.test(question)) {
    const events = snapshot.events.filter((e) => e.id === page.eventId || e.id === previous.eventId)
    return draft('页面事件与上轮事件不同，请选择要继续讨论的事件。', {
      status: 'need_choice', candidates: events.map((e) => ({ id: e.id, label: e.eventNo, detail: snapshot.points.find((p) => p.id === e.pointId)?.code ?? '测点已失效' })),
    })
  }
  if (current !== undefined && old !== undefined && current !== old && /它|这面墙|这条|这个|该测点|照片|视频|恢复|处理/.test(question)) {
    const points = snapshot.points.filter((p) => !p.archived && (p.id === current || p.id === old))
    return draft('页面选中的测点与上一轮讨论的测点不同，请选择这句问题指的是哪一个。', {
      status: 'need_choice', candidates: toCandidates(points),
    })
  }
  return Object.keys(page).length > 0 ? page : previous
}

export function candidateContext(candidate: AskCandidate, snapshot: AssistantSnapshot): AskContext {
  if (snapshot.events.some((e) => e.id === candidate.id)) return { eventId: candidate.id, chosen: true }
  return { pointId: candidate.id, chosen: true }
}

/** 只接收当前档案中存在的路由对象；问题/工单沿真实关联还原事件。 */
export function routeContext(query: Record<string, unknown>, snapshot: AssistantSnapshot): AskContext {
  const point = snapshot.points.find((p) => p.id === query.point && !p.archived)
  if (point) return { pointId: point.id }
  const order = snapshot.workOrders.find((o) => o.id === query.workOrder)
  const issue = snapshot.issues.find((i) => i.id === (query.issue ?? order?.issueId))
  const event = snapshot.events.find((e) => e.id === (query.event ?? issue?.eventId))
  return event ? { eventId: event.id } : {}
}
