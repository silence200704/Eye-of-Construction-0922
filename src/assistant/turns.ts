/** 单轮问答的远程/本地执行：只做状态更新，不拥有会话 store。 */
import { currentEpoch } from '@/api/backend/runtime'
import { useBackendSessionStore } from '@/stores/backend/session'
import { contextPayload, askRemote } from './remote/session'
import { assembleAnswer } from './ask'
import { askWithDirector } from './director/entry'
import { directorIntent } from './director/intent'
import { queryContext } from './query/context'
import { buildSnapshot } from './selectors'
import type { AskContext, AskPreview, AskResult, AskStage } from './types'
import type { AskTurn } from './session'

export interface TurnRequest {
  id: string
  text: string
  generation: number
  actorId: string
  epoch: number
  readOnly?: boolean
  previousVisual?: AskPreview
}

export interface TurnContext {
  sessionId: { value: string }
  context: { value: AskContext }
  pageContext: { value: AskContext }
  contextLabel: { value: string }
  guideActive: { value: boolean }
  guideEventId: { value: string }
  guideCanPrepare: { value: boolean }
  requestContext: { value: AskContext | null }
  stillCurrent: (generation: number) => boolean
  update: (id: string, patch: Partial<AskTurn>) => void
  remember: (sessionId: string) => void
  flash: (result: AskResult | null) => void
  clearContext: () => void
  beginGuide: (eventId: string) => void
  endGuide: () => void
}

function stale(input: TurnRequest, state: TurnContext): boolean {
  return (
    !state.stillCurrent(input.generation)
    || input.actorId !== (useBackendSessionStore().user?.id ?? '')
    || input.epoch !== currentEpoch()
  )
}

function applyContext(state: TurnContext, result: AskResult): void {
  if (result.context) state.context.value = result.context
  else if (result.pointId !== null) state.context.value = { pointId: result.pointId }
  if (result.gaps.some((gap) => gap.includes('重新选择'))) {
    state.context.value = {}
    state.contextLabel.value = ''
  }
}

export async function askRemoteTurn(input: TurnRequest, state: TurnContext): Promise<void> {
  const remote = await askRemote({
    question: input.text,
    sessionId: state.sessionId.value,
    context: contextPayload(state.context.value, state.pageContext.value),
    stillCurrent: () => state.stillCurrent(input.generation),
  })
  if (stale(input, state)) return
  state.remember(remote.sessionId)
  state.update(input.id, { result: remote.result })
  applyContext(state, remote.result)
  state.flash(remote.result)
  if (remote.result.status === 'not_found' && remote.result.conclusion.includes('已不在当前数据集')) {
    state.clearContext()
  }
}

export async function askLocalTurn(input: TurnRequest, state: TurnContext): Promise<void> {
  const resolved = queryContext({
    question: input.text,
    page: state.pageContext.value,
    previous: state.context.value,
    snapshot: buildSnapshot(),
  })
  const request = {
    context: 'conclusion' in resolved ? {} : { ...resolved },
    visualResult: input.previousVisual?.kind === 'visual_evidence'
      ? input.previousVisual.results[input.previousVisual.active] ?? undefined
      : undefined,
    onStage: (stage: AskStage) => {
      if (state.stillCurrent(input.generation)) state.update(input.id, { stage })
    },
  }
  state.requestContext.value = request.context
  const result = 'conclusion' in resolved
    ? assembleAnswer(input.text, 'unknown', resolved, buildSnapshot())
    : await askWithDirector(input.text, request, input.readOnly)
  if (stale(input, state)) return
  state.update(input.id, { result })
  if (result.context) state.context.value = result.context
  applyGuide(state, result)
  if (result.pointId !== null && !result.context) applyPointContext(input, state, result.pointId, result)
  state.flash(result)
  if (result.status === 'not_found' && result.conclusion.includes('已不在当前数据集')) state.clearContext()
}

function applyGuide(state: TurnContext, result: AskResult): void {
  if (result.intent !== 'demo_guide') return
  state.guideActive.value = result.guide !== null && (result.guide.eventId !== null || result.guide.canPrepare)
  state.guideEventId.value = result.guide?.eventId ?? ''
  state.guideCanPrepare.value = result.guide?.canPrepare ?? false
  if (state.guideEventId.value !== '') state.beginGuide(state.guideEventId.value)
}

function applyPointContext(
  input: TurnRequest,
  state: TurnContext,
  pointId: string,
  result: AskResult,
): void {
  const snapshot = buildSnapshot()
  const guideEvent = snapshot.events.find((row: { id: string; pointId: string }) => row.id === state.guideEventId.value)
  if (
    state.guideActive.value
    && (guideEvent?.pointId !== pointId
      || (directorIntent(input.text) !== null && result.guide === null))
  ) {
    state.endGuide()
  }
  const event = snapshot.events.find(
    (row: { id: string; pointId: string | null }) =>
      row.id === state.context.value.eventId && row.pointId === pointId,
  )
  state.context.value = { pointId, ...(event === undefined ? {} : { eventId: event.id }) }
  if (event === undefined) {
    state.contextLabel.value = snapshot.points.find((row: { id: string; code: string }) => row.id === pointId)?.code ?? ''
  }
}
