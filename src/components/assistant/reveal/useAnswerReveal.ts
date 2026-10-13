/**
 * 本地回答的展示节奏。数据已经由问答层算出；这里仅控制观众看见它的顺序。
 *
 * 两条不会破的线：
 * 1. **进度不假装比实际做得快**：视觉证据联动会按真实完成阶段上报步骤，
 *    显示的步骤号取"按下标节奏推进"与"真实完成度"的较小值；
 * 2. 任何时刻都提供「立即显示全部」（`showAll`）：观众不想等就直接看结果，
 *    减少动态效果（prefers-reduced-motion）时连展示节奏都不走。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AskResult, AskStage } from '@/assistant/types'
import type { AskTurn } from '@/assistant/session'

export type AnswerSection = 'summary' | 'visual' | 'facts' | 'source' | 'evidence' | 'limits' | 'links'

export function answerSections(result: AskResult): AnswerSection[] {
  return [
    'summary',
    ...(result.previews.length > 0 ? ['visual'] as const : []),
    ...(result.facts.length > 0 ? ['facts'] as const : []),
    ...(result.timing !== null || result.provenance !== null ? ['source'] as const : []),
    ...(result.evidence.length > 0 || result.candidates.length > 0 ? ['evidence'] as const : []),
    ...(result.gaps.length > 0 || result.dataNotes.length > 0 ? ['limits'] as const : []),
    ...(result.links.length > 0 ? ['links'] as const : []),
  ]
}

/** 每个思考步骤的展示节拍；步骤多的问法（视觉联动四步）自然展示得更久一些。 */
const STEP_MS = 380
/** 步骤展示完之后留一点停顿再出结论 */
const THINK_TAIL_MS = 400
const REVEAL_MS = 280

export function useAnswerReveal(options: {
  turn: () => AskTurn
  active: () => boolean
  complete: (id: string) => void
  /** 这条回答的思考步骤（按真实流水线给出）；不给就用调用方的固定三步 */
  steps?: () => string[]
}) {
  const phase = ref<'thinking' | 'revealing' | 'complete'>('thinking')
  const thinkingStep = ref(0)
  const revealed = ref(0)
  /** 展示节奏推进到第几步（纯展示，不代表真实进度） */
  const paced = ref(0)
  const sections = computed(() => options.turn().result === null ? [] : answerSections(options.turn().result!))
  const stepCount = computed(() => options.steps?.().length ?? 0)
  const timers: ReturnType<typeof setTimeout>[] = []
  const reduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let thoughtFinished = false

  /**
   * 显示的步骤 = min(展示节奏, 真实完成度)。
   * 真实完成度来自编排上报的阶段；没有上报阶段（普通问法）时按展示节奏走。
   */
  const stageIndex = computed(() => {
    const stage = options.turn().stage
    if (stage === null) return Number.POSITIVE_INFINITY
    const order: AskStage[] = ['records', 'media', 'compare', 'compose']
    return order.indexOf(stage)
  })

  watch(
    () => [paced.value, stageIndex.value],
    () => {
      thinkingStep.value = Math.max(0, Math.min(paced.value, stageIndex.value))
    },
    { immediate: true },
  )

  function schedule(action: () => void, delay: number): void {
    timers.push(setTimeout(action, delay))
  }

  function stopTimers(): void {
    for (const timer of timers) clearTimeout(timer)
    timers.length = 0
  }

  function finish(): void {
    stopTimers()
    phase.value = 'complete'
    revealed.value = sections.value.length
    options.complete(options.turn().id)
  }

  /** 「立即显示全部」：跳过剩下的展示节奏与逐段呈现。 */
  function showAll(): void {
    finish()
  }

  function revealNext(): void {
    if (phase.value !== 'revealing') return
    revealed.value += 1
    if (revealed.value >= sections.value.length) finish()
    else schedule(revealNext, REVEAL_MS)
  }

  function maybeReveal(): void {
    if (phase.value !== 'thinking') return
    if (options.turn().error !== '') { finish(); return }
    if (!thoughtFinished || options.turn().result === null) return
    phase.value = 'revealing'
    revealed.value = 1
    if (sections.value.length <= 1) finish()
    else schedule(revealNext, REVEAL_MS)
  }

  if (options.turn().presented || !options.active() || reduced) {
    finish()
  } else {
    const last = Math.max(0, (options.steps?.().length ?? 3) - 1)
    for (let step = 1; step <= last; step += 1) {
      schedule(() => { paced.value = step }, STEP_MS * step)
    }
    schedule(() => { thoughtFinished = true; maybeReveal() }, STEP_MS * last + THINK_TAIL_MS)
  }

  watch(() => [options.turn().result, options.turn().error], maybeReveal)
  watch(() => options.active(), (active) => { if (!active) finish() })
  onBeforeUnmount(finish)

  function shown(section: AnswerSection): boolean {
    if (phase.value === 'complete') return true
    if (phase.value === 'thinking') return false
    const index = sections.value.indexOf(section)
    return index >= 0 && index < revealed.value
  }

  return { phase, thinkingStep, stepCount, shown, showAll }
}
