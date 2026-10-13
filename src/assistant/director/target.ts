import { normalizeQuestion, extractEntities, hasPointClue } from '../parse'
import { resolvePoint, toCandidates, type PointRef } from '../resolve'
import { PREPARATION_TARGETS } from '@/core/demo/preparation/policy'
import type { AssistantSnapshot } from '../selectors'
import type { AskContext } from '../types'
import { draft, type AnswerDraft } from '../answers/shared'

export function directorTarget(question: string, context: AskContext, snapshot: AssistantSnapshot): PointRef | AnswerDraft {
  const normalized = normalizeQuestion(question)
  const entities = extractEntities(normalized)
  if (entities.eventNo !== null) {
    const event = snapshot.events.find((row) => row.eventNo.toUpperCase() === entities.eventNo?.toUpperCase())
    const point = snapshot.points.find((row) => row.id === event?.pointId && !row.archived)
    return point ?? draft(`当前档案找不到事件 ${entities.eventNo} 对应的在册测点。`, { status: 'not_found' })
  }
  const hasTarget = hasPointClue(entities)
  if (!hasTarget && (context.pointId !== undefined || context.eventId !== undefined)) {
    const id = context.pointId ?? snapshot.events.find((row) => row.id === context.eventId)?.pointId
    return snapshot.points.find((row) => row.id === id && !row.archived)
      ?? draft('上一轮选定的对象已不在当前数据集，请重新选择。', { status: 'not_found' })
  }
  const resolved = resolvePoint({ question: normalized.compact, entities, buildings: snapshot.buildings, points: snapshot.points })
  if (resolved.status === 'exact' || resolved.status === 'unique') return resolved.points[0]
  if (resolved.status === 'ambiguous' && context.chosen === true) {
    const chosen = resolved.points.find((p) => p.id === context.pointId)
    if (chosen) return chosen
  }
  const candidates = resolved.status === 'ambiguous' ? resolved.points
    : !hasTarget ? snapshot.points.filter((row) => !row.archived && PREPARATION_TARGETS.some((target) => target.id === row.id)) : []
  return draft(candidates.length > 0 ? '请选择要分析或定位的测点。' : resolved.reason, {
    status: candidates.length > 0 ? 'need_choice' : 'not_found', candidates: toCandidates(candidates),
  })
}
