import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Region } from '@/core/media/compare'
import { useClockStore } from '@/stores/clock'
import { useBackendSessionStore } from '@/stores/backend/session'
import { backendActive, currentEpoch, epochVersion } from '@/api/backend/runtime'
import { datasetResetVersion, readRegistry } from '@/stores/demo/registry'
import { candidateContext } from './query/context'
import { assembleAnswer } from './ask'
import { REMOTE_INTENTS, createRemoteSessionState } from './remote/session'
import { directorIntent } from './director/intent'
import type { GuidePlan } from './guide/plan'
import { createGuideRunner } from './guide/reread'
import { askLocalTurn, askRemoteTurn, type TurnContext, type TurnRequest } from './turns'
import { buildSnapshot, findPoint } from './selectors'
import type { AskCandidate, AskContext, AskResult, AskStage } from './types'
import { normalizeQuestion, extractEntities, parseIntent } from './parse'
import { featureIntent } from './features/intent'
import { isShowcase } from '@/core/demo/workspace'

export type VisualAction =
  | { kind: 'region'; key: 'crack' | 'control' }
  | { kind: 'custom'; region: Region }

export interface AskTurn {
  id: string
  question: string
  /** 回答；出错时保留 null 并把原因放进 error */
  result: AskResult | null
  error: string
  /** 展示动画播过后不再重播；问答计算与此字段无关。 */
  presented: boolean
  /**
   * 视觉证据联动的**真实完成阶段**（由编排上报）；普通问法是 null。
   * 界面显示进度时不会跑到它前面去 —— 进度不假装比实际做得快。
   */
  stage: AskStage | null
}

/** 小瞳形象的四态，由会话状态推导，不由回答内容猜。 */
export type MascotState = 'idle' | 'searching' | 'found' | 'empty'

/**
 * 单条回答对应的形象状态：有结论算"找到证据"，没有可用结果或无数据算"无数据"。
 * 回答头像用这个映射（它就该安静地停在这个状态上）。
 */
export function mascotStateOf(result: AskResult | null): MascotState {
  if (result === null) return 'idle'
  if (result.status === 'awaiting_confirmation') return 'idle'
  return result.status === 'answered' ? 'found' : 'empty'
}

export const ENTRY_BURST_MS = 2600

/** 从对象详情唤起时用的默认问法：带上下文才有意义，所以直接替用户问出来。 */
const DEFAULT_QUESTION: Record<'point' | 'event', string> = {
  point: '它怎么样',
  event: '为什么这条是红色',
}

let seq = 0

export const useAssistantStore = defineStore('assistant', () => {
  const open = ref(false)
  const busy = ref(false)
  const turns = ref<AskTurn[]>([])
  const context = ref<AskContext>({})
  const pageContext = ref<AskContext>({})
  let queryGeneration = 0
  let requestContext: AskContext | null = null
  const datasetStamp = ref(readRegistry().resetAt)
  /** 上下文对象的来源说明：界面上要写清"当前上下文是什么"，避免追问对象不明确 */
  const contextLabel = ref('')
  const notice = ref('')
  const guideActive = ref(false)
  const guideEventId = ref('')
  const guideCanPrepare = ref(false)
  const guidePlan = ref<GuidePlan | null>(null)
  const guideLoading = ref(false)
  const guideRunner = createGuideRunner({ guideActive, guideEventId, guideCanPrepare, guidePlan, guideLoading, notice })
  const endGuide = guideRunner.end
  const rereadGuide = guideRunner.reread
  const remoteSession = createRemoteSessionState({
    turns,
    context,
    pageContext,
    contextLabel,
    notice,
    endGuide,
    bumpGeneration: () => { queryGeneration += 1 },
    turnOf: (row) => row,
  })
  const sessionId = remoteSession.sessionId
  const rememberServerSession = remoteSession.remember
  const clearServerTurns = remoteSession.clear
  async function restoreServerSession(): Promise<void> {
    if (!backendActive()) return
    await remoteSession.restore()
  }
  /** 入口的一次性反馈；null 表示没有正在进行的反馈 */
  const entryBurst = ref<MascotState | null>(null)
  let burstTimer: ReturnType<typeof setTimeout> | null = null

  const last = computed<AskTurn | null>(() => (turns.value.length === 0 ? null : turns.value[turns.value.length - 1]))

  /**
   * 悬浮入口用的状态：检索中持续到有结果，反馈型状态到点回落待机。
   * 与 `mascotState`（面板头部用的语义状态）分开，是因为两者的"该停留多久"本来就不同。
   */
  const entryState = computed<MascotState>(() => {
    if (busy.value) return 'searching'
    return entryBurst.value ?? 'idle'
  })

  /** 记一次一次性反馈：找到证据 / 无数据都只亮一下 */
  function flashEntry(state: MascotState): void {
    if (state === 'idle') return
    if (burstTimer !== null) clearTimeout(burstTimer)
    entryBurst.value = state
    burstTimer = setTimeout(() => {
      entryBurst.value = null
      burstTimer = null
    }, ENTRY_BURST_MS)
  }

  const mascotState = computed<MascotState>(() => {
    if (busy.value) return 'searching'
    const result = last.value?.result ?? null
    if (result === null) return 'idle'
    if (result.status === 'awaiting_confirmation') return 'idle'
    if (result.status === 'answered') return 'found'
    return 'empty'
  })

  const questions = computed(() => turns.value.length)

  function toggle(): void {
    if (!open.value) {
      syncDataset()
      void restoreServerSession()
      // 打开导览时重读数据库：别处（另一个入口/另一个标签）刚写过的状态要能被看到
      if (guideActive.value) void rereadGuide()
    }
    open.value = !open.value
  }

  function close(): void {
    open.value = false
  }

  function setPageContext(next: AskContext): void {
    if (busy.value && requestContext !== null && Object.keys(next).length > 0) {
      const snapshot = buildSnapshot()
      const pointId = (c: AskContext): string | undefined => c.pointId ?? snapshot.events.find((e) => e.id === c.eventId)?.pointId
      if (pointId(next) !== pointId(requestContext)) queryGeneration += 1
    }
    pageContext.value = next
  }

  function clearContext(): void {
    queryGeneration += 1
    pageContext.value = {}
    context.value = {}
    contextLabel.value = ''
    notice.value = ''
    endGuide()
  }

  /** 数据集被整体替换过就清空会话，避免旧结论与新数据并排显示。 */
  function syncDataset(force = false): void {
    const at = readRegistry().resetAt
    if (!force && at === datasetStamp.value) return
    datasetStamp.value = at
    if (turns.value.length > 0 || sessionId.value !== '') {
      clearServerTurns('数据集已切换（清空 / 重新载入 / 导入备份），已清空上一轮的问答记录。')
      return
    }
    pageContext.value = {}
    context.value = {}
    contextLabel.value = ''
    endGuide()
    notice.value = '数据集已切换（清空 / 重新载入 / 导入备份），已清空上一轮的问答记录。'
  }

  watch(datasetResetVersion, () => syncDataset(true), { flush: 'sync' })
  watch(epochVersion, () => {
    if (turns.value.length > 0 || sessionId.value !== '') {
      clearServerTurns('数据集已复位（epoch 变化），旧会话与对象上下文已失效，请重新提问。')
    }
  })
  watch(
    () => useBackendSessionStore().user?.id ?? '',
    () => {
      if (turns.value.length > 0 || sessionId.value !== '') {
        clearServerTurns('身份已切换，旧会话已清空。')
      }
    },
  )

  function clearTurns(): void {
    queryGeneration += 1
    turns.value = []
    notice.value = ''
    endGuide()
  }

  /** 场景写入后按当前快照复核对象；不凭场景返回的提示文字宣布导览成功。 */
  function beginGuide(eventId: string, requirePendingRed = false): boolean {
    const event = buildSnapshot().events.find((row) => row.id === eventId)
    if (event === undefined || (requirePendingRed && (event.level !== 'red' || event.status !== 'pending'))) return false
    guideActive.value = true
    guideEventId.value = event.id
    guideCanPrepare.value = false
    context.value = { eventId: event.id }
    contextLabel.value = `预警事件 ${event.eventNo}`
    // 阶段卡随后按数据库重读后再算，不拿调用方手里那份可能过期的快照
    void rereadGuide()
    return true
  }

  /** 从测点卡 / 事件详情唤起：带上对象并立刻问一句默认问法。 */
  async function openWith(kind: 'point' | 'event', id: string, label: string, question = DEFAULT_QUESTION[kind]): Promise<void> {
    syncDataset()
    open.value = true
    await restoreServerSession()
    queryGeneration += 1
    context.value = kind === 'point' ? { pointId: id } : { eventId: id }
    contextLabel.value = label
    if (guideActive.value) guideEventId.value = kind === 'event' ? id : ''
    notice.value = ''
    await ask(question)
  }

  /** 点候选继续问：把候选转成明确的上下文，再问同一个问题。 */
  async function chooseCandidate(candidate: AskCandidate, question: string): Promise<void> {
    queryGeneration += 1
    context.value = { ...context.value, ...candidateContext(candidate, buildSnapshot()) }
    contextLabel.value = candidate.label
    notice.value = ''
    await ask(question)
  }

  const turnContext: TurnContext = {
    sessionId,
    context,
    pageContext,
    contextLabel,
    guideActive,
    guideEventId,
    guideCanPrepare,
    requestContext: { get value() { return requestContext }, set value(next) { requestContext = next } },
    stillCurrent: (generation: number) => generation === queryGeneration,
    update,
    remember: rememberServerSession,
    flash: (result: AskResult | null) => flashEntry(mascotStateOf(result)),
    clearContext,
    beginGuide,
    endGuide,
  }

  async function ask(question: string, options: { readOnly?: boolean } = {}): Promise<void> {
    const text = question.trim()
    if (text === '' || busy.value) return
    if (isShowcase) {
      busy.value = true
      const { useShowcaseStore } = await import('@/stores/demo/showcase/session')
      await useShowcaseStore().pause()
      busy.value = false
    }
    syncDataset()
    const generation = queryGeneration
    const normalized = normalizeQuestion(text)
    const localIntent = featureIntent(text, context.value) ?? parseIntent(normalized, extractEntities(normalized))
    const useRemote = backendActive() && REMOTE_INTENTS.has(localIntent)
    const previousVisual = turns.value.flatMap((t) => t.result?.previews ?? []).filter((p) => p.kind === 'visual_evidence').slice(-1)[0]
    seq += 1
    const id = `turn_${seq}`
    turns.value = [...turns.value, { id, question: text, result: null, error: '', presented: false, stage: null }]
    busy.value = true
    const request: TurnRequest = {
      id,
      text,
      generation,
      actorId: useBackendSessionStore().user?.id ?? '',
      epoch: currentEpoch(),
      readOnly: options.readOnly,
      previousVisual,
    }
    if (useRemote) requestContext = { ...context.value, ...pageContext.value }
    try {
      if (useRemote) {
        await askRemoteTurn(request, turnContext)
        return
      }
      await askLocalTurn(request, turnContext)
    } catch (cause) {
      if (generation !== queryGeneration) return
      update(id, { error: cause instanceof Error ? cause.message : String(cause) })
    } finally {
      if (generation !== queryGeneration) update(id, { error: '对象或会话已切换，本次请求已取消，请重新提问。' })
      requestContext = null
      busy.value = false
    }
  }

  async function applyVisual(turnId: string, action: VisualAction): Promise<void> {
    if (busy.value) return
    syncDataset()
    const turn = turns.value.find((row) => row.id === turnId)
    const visual = turn?.result?.previews.find((row) => row.kind === 'visual_evidence')
    if (turn === undefined || turn.result === null || visual === undefined || visual.kind !== 'visual_evidence') return
    if (visual.pair === null) {
      notice.value = '缺少可比照片对，请加入影像后重新提问。'
      return
    }
    const generation = queryGeneration
    requestContext = { pointId: visual.pointId }
    busy.value = true
    try {
      const snapshot = buildSnapshot()
      const point = findPoint(snapshot, visual.pointId)
      if (point === undefined) {
        notice.value = '这条回答的测点已不在当前数据集里，无法就地重算；请重新选择测点后再问。'
        return
      }
      const { answerVisualEvidence } = await import('./linkage/run')
      const draft = await answerVisualEvidence({
        snapshot,
        point,
        matchNote: '沿用这条回答的测点',
        pair: visual.pair,
        active: action.kind === 'region' ? action.key : 'custom',
        customRegion: action.kind === 'custom' ? action.region : null,
        onStage: (stage) => { if (generation === queryGeneration) update(turnId, { stage }) },
      })
      if (generation !== queryGeneration) return
      update(turnId, { result: assembleAnswer(turn.question, turn.result.intent, draft, snapshot) })
      notice.value = action.kind === 'region'
        ? `已按「${action.key === 'crack' ? '登记裂缝区' : '完好墙面'}」重新计算，在这条回答里更新，没有新增一轮。`
        : '已按你框选的区域重新计算，在这条回答里更新，没有新增一轮。'
    } catch (cause) {
      if (generation !== queryGeneration) return
      notice.value = `区域重算失败：${cause instanceof Error ? cause.message : String(cause)}`
    } finally {
      requestContext = null
      busy.value = false
    }
  }

  /** 显式刷新：推进共享时钟 → 重问上一条问题 → 重读导览阶段。不引后台定时器。 */
  async function refresh(): Promise<void> {
    syncDataset()
    useClockStore().refresh()
    const question = last.value?.question ?? ''
    if (question === '') {
      notice.value = '已按当前时刻刷新；先问一句就会用新的时间口径重新读数据。'
      if (guideActive.value) await rereadGuide()
      return
    }
    notice.value = '已按当前时刻重新读取数据。'
    const result = last.value?.result
    const code = buildSnapshot().points.find((row) => row.id === result?.pointId)?.code ?? ''
    const readQuestion = directorIntent(question) !== null && result?.pointId != null
      ? result.guide !== null ? '这个问题处理到哪了？' : result.previews.some((row) => row.kind === 'video_evidence') ? question : result.previews.some((row) => row.kind === 'visual_evidence') ? `${code}的裂缝有什么变化？给我看证据` : `${code}怎么样`
      : question
    await ask(readQuestion, { readOnly: true })
    if (guideActive.value) await rereadGuide()
  }

  /** 确认式演示写入后，用真实新快照替换旧的导览回答，避免同屏自相矛盾。 */
  async function refreshGuideAfterWrite(): Promise<void> {
    turns.value = turns.value.filter((row) => row.result?.intent !== 'demo_guide')
    await ask('这个问题处理到哪了？')
    await rereadGuide()
  }

  function update(id: string, patch: Partial<AskTurn>): void {
    turns.value = turns.value.map((row) => (row.id === id ? { ...row, ...patch } : row))
  }

  function markPresented(id: string): void {
    const turn = turns.value.find((row) => row.id === id)
    if (turn !== undefined && !turn.presented) update(id, { presented: true })
  }

  return {
    open,
    busy,
    turns,
    context,
    pageContext,
    setPageContext,
    contextLabel,
    notice,
    guideActive,
    guideEventId,
    guideCanPrepare,
    guidePlan,
    guideLoading,
    last,
    mascotState,
    entryState,
    questions,
    toggle,
    close,
    clearContext,
    clearTurns,
    endGuide,
    beginGuide,
    rereadGuide,
    openWith,
    chooseCandidate,
    ask,
    applyVisual,
    refresh,
    refreshGuideAfterWrite,
    markPresented,
  }
})
