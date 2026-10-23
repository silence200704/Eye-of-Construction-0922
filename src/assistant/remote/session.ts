/** 服务端会话的存取、上下文载荷与回答合并；store 只保留状态与交互编排。 */
import { ref, type Ref } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import { readRegistry } from '@/stores/demo/registry'
import { askServer, fetchSession, type RemoteSession } from '@/api/backend/assistant'
import { askZhutong } from '../ask'
import { reloadAssistantSources } from '../selectors'
import type { AskContext, AskIntent, AskResult, AskStage } from '../types'
import { mapServerAnswer } from './answer'

/** 服务端给业务答复的意图；其余视觉/比较/回放/试算/导览仍走现有前端编排。 */
export const REMOTE_INTENTS = new Set<AskIntent>([
  'point_status',
  'point_trend',
  'event_reason',
  'open_events',
  'campus_overview',
  'issue_status',
  'knowledge',
  'unknown',
  'demo_command',
])

export interface RestoredTurn {
  id: string
  question: string
  result: AskResult | null
  error: string
  presented: boolean
  stage: AskStage | null
}

export function sessionStorageKey(resetAt: string, actorId: string): string {
  return `zhutong.assistant.session.${actorId}.${resetAt}`
}

export function readStoredSession(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

export function persistSession(key: string, id: string): void {
  try {
    sessionStorage.setItem(key, id)
  } catch {
    /* 隐私模式禁用存储时只保留内存会话 */
  }
}

export function dropSession(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    /* 同上 */
  }
}

/** 上下文载荷：页面对象优先于上一轮；问句显式编号由服务端再覆盖。 */
export function contextPayload(
  context: AskContext,
  page: AskContext,
): Record<string, unknown> {
  const merged: Record<string, unknown> = context.chosen
    ? { ...context }
    : { ...context, ...page }
  for (const key of ['pointId', 'eventId', 'issueId', 'workOrderId', 'videoId', 'replayNode']) {
    if (merged[key] === undefined) delete merged[key]
  }
  merged.source = Object.keys(page).length > 0 ? 'page' : 'previous'
  return merged
}

export function restoredTurns(detail: RemoteSession): RestoredTurn[] {
  return (detail.turns ?? []).map((turn) => ({
    id: turn.id,
    question: turn.question,
    result: mapServerAnswer(turn.answer, turn.question, turn.createdAt),
    error: '',
    presented: true,
    stage: null,
  }))
}

export async function loadRemoteSession(sessionId: string): Promise<RestoredTurn[]> {
  const detail = await fetchSession(sessionId)
  return restoredTurns(detail)
}

/** 会话状态：会话 ID 与身份、数据集绑定；恢复只读，不重放任何写入或媒体处理。 */
export function createRemoteSessionState<T extends RestoredTurn>(input: {
  turns: Ref<T[]>
  context: Ref<AskContext>
  pageContext: Ref<AskContext>
  contextLabel: Ref<string>
  notice: Ref<string>
  endGuide: () => void
  bumpGeneration: () => void
  turnOf: (row: RestoredTurn) => T
}) {
  const sessionId = ref('')
  let restored = false
  const key = (): string =>
    sessionStorageKey(readRegistry().resetAt, useBackendSessionStore().user?.id ?? 'none')

  function remember(id: string): void {
    sessionId.value = id
    restored = true
    persistSession(key(), id)
  }

  function forget(): void {
    sessionId.value = ''
    restored = false
    dropSession(key())
  }

  function clear(noticeText: string): void {
    input.bumpGeneration()
    forget()
    input.turns.value = []
    input.pageContext.value = {}
    input.context.value = {}
    input.contextLabel.value = ''
    input.endGuide()
    input.notice.value = noticeText
  }

  async function restore(): Promise<void> {
    if (restored) return
    restored = true
    const stored = sessionId.value !== '' ? sessionId.value : readStoredSession(key())
    if (stored === '') return
    try {
      const rows = await loadRemoteSession(stored)
      if (rows.length === 0) return
      sessionId.value = stored
      input.turns.value = rows.map(input.turnOf)
      const lastResult = rows[rows.length - 1]?.result
      if (lastResult?.context) input.context.value = lastResult.context
      input.notice.value = '已恢复上次小瞳会话（只读；不会重放写入、影像处理或自动导览）。'
    } catch {
      forget()
    }
  }

  return { sessionId, remember, forget, clear, restore }
}

export interface RemoteReply {
  sessionId: string
  result: AskResult
}

/** 提问 → 结构化回答；趋势问法再合并前端图表预览（图仍由已有算法从服务端记录绘制）。 */
export async function askRemote(input: {
  question: string
  sessionId: string
  context: Record<string, unknown>
  stillCurrent: () => boolean
}): Promise<RemoteReply> {
  let reply
  try {
    reply = await askServer({
      question: input.question,
      sessionId: input.sessionId === '' ? undefined : input.sessionId,
      context: input.context,
    })
  } catch (cause) {
    throw new Error(`无法读取服务端小瞳回答（后端断开或请求失败）：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  const result = mapServerAnswer(reply.answer, input.question)
  if (input.stillCurrent() && result.intent === 'point_trend' && result.pointId !== null) {
    try {
      await reloadAssistantSources()
      const local = await askZhutong(input.question, { context: { pointId: result.pointId } })
      if (!input.stillCurrent()) return { sessionId: reply.sessionId, result }
      if (local.previews.length > 0) result.previews = local.previews
      if (local.timing !== null && result.timing === null) result.timing = local.timing
      if (local.provenance !== null && result.provenance === null) result.provenance = local.provenance
      if (local.status !== 'answered' && local.gaps.length > 0) result.dataNotes.push(...local.gaps)
    } catch (cause) {
      result.dataNotes.push(`趋势图未生成：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return { sessionId: reply.sessionId, result }
}
