<script setup lang="ts">
/**
 * 问筑瞳半屏面板。
 *
 * 桌面端从右侧展开、约占一半视宽，**左侧原页面仍可点**（所以它不是模态框、不做焦点陷阱）；
 * 约 900 px 以下改全屏，点完链接或按 Esc 关回入口按钮。
 *
 * 装饰动画在红色预警弹窗出现时暂停（`paused`），把注意力让给预警本身。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { routeContext } from '@/assistant/query/context'
import { buildSnapshot } from '@/assistant/selectors'
import { useMediaStore } from '@/stores/media'
import { taskQuestions } from '@/assistant/director/questions'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useAssistantStore, type VisualAction } from '@/assistant/session'
import type { AskCandidate, AskLink } from '@/assistant/types'
import { useAlertStore } from '@/stores/alerts'
import AskAnswer from './AskAnswer.vue'
import AskComposer from './AskComposer.vue'
import AssistantHeader from './presentation/AssistantHeader.vue'
import AssistantWelcome from './presentation/AssistantWelcome.vue'
import { navigateFromAnswer } from './presentation/navigation'
import GuideCard from './guide/GuideCard.vue'
import TaskStatusCard from './tasks/TaskStatusCard.vue'
import { useDirectorStore } from '@/assistant/director/state'
import { usePreparationSession } from '@/stores/demo/preparation/session'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const assistant = useAssistantStore()
const alerts = useAlertStore()
const router = useRouter()
const archive = useArchiveStore()
const events = useEventsStore()
const director = useDirectorStore()
const preparation = usePreparationSession()
const mediaStore = useMediaStore()
watch(() => [router.currentRoute.value.fullPath, archive.loaded, events.loaded], () => {
  assistant.setPageContext(routeContext(router.currentRoute.value.query, buildSnapshot()))
}, { immediate: true })
const selectedPoint = computed(() => {
  const preferred = Object.keys(assistant.pageContext).length > 0 ? assistant.pageContext : assistant.context
  const id = preferred.pointId ?? events.byId(preferred.eventId ?? '')?.pointId
  return id === undefined ? undefined : archive.pointById(id)
})
const exampleQuestions = computed(() => taskQuestions({
  code: selectedPoint.value?.code,
  focus: router.currentRoute.value.path === '/media' ? 'media' : undefined,
  visual: selectedPoint.value?.id === 'pnt_b03_f2_crack01' || mediaStore.frames.filter((f) => f.pointId === selectedPoint.value?.id && f.origin !== 'demo_public').length >= 2,
  hasVideo: mediaStore.videoMeta?.pointId === selectedPoint.value?.id,
  event: assistant.pageContext.eventId !== undefined || assistant.context.eventId !== undefined,
  authorized: preparation.active,
}))
const exampleScope = computed(() => selectedPoint.value === undefined
  ? '未选定测点：先询问全校情况，或从测点详情打开小瞳。'
  : `当前推荐对象：${selectedPoint.value.code} ${selectedPoint.value.name}；照片问题仅针对该测点的影像。`)

const panelEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)

/**
 * 旧回答折叠。
 *
 * 导览模式下观众要看的是"当前阶段 + 下一步"，整页长回答会把阶段卡挤出视口。
 * 默认只展开最近一条，其余折成一行问句（可点开回看，证据与审计信息都不删）。
 */
const collapsed = ref<Record<string, boolean>>({})
function isCollapsed(id: string, index: number): boolean {
  const explicit = collapsed.value[id]
  if (explicit !== undefined) return explicit
  return assistant.guideActive && index < assistant.turns.length - 1
}

function toggleTurn(id: string, index: number): void {
  collapsed.value = { ...collapsed.value, [id]: !isCollapsed(id, index) }
}

/** 动画偏好：尊重"减少动态效果"时不做平滑滚动 */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/**
 * 进入导览时把视口拉回顶部：阶段卡在面板最上面。
 *
 * 注意与下面的"跟随最新一轮"的先后：两个 watcher 都 `await nextTick`，
 * 回调按注册顺序执行 —— 这个在前、跟随最新的那个在后，所以**同时发生时以"跟随最新"为准**。
 * 这也是用户要的：刚问完要看得见新对话，而不是只看阶段卡。
 */
watch(
  () => assistant.guideActive,
  (active) => {
    if (!active) return
    if (latestKey.value !== '') return
    void nextTick(() => bodyEl.value?.scrollTo({ top: 0, behavior: scrollBehavior() }))
  },
)

/**
 * 最新一轮的键：新一轮提问、回答落地、出错都会变。
 * `ask()` 是先插入提问那一轮再回填答案，轮数不变，所以不能只盯 turns.length。
 */
const latestKey = computed(() => {
  const last = assistant.turns[assistant.turns.length - 1]
  return last === undefined ? '' : `${last.id}|${last.result === null ? 'pending' : 'done'}|${last.error}`
})

/**
 * 有新一轮问答时把视口带到最新一轮。
 *
 * 对齐到**这一轮的起点**，而不是把容器滚到底：回答卡常有 600–900px、比面板还高，
 * 真滚到底只会看见最后的"去向与口径"，结论和数字反而被推到视野外 ——
 * 用户要看的是"新对话的过程"，从问题行与结论看起才对。
 */
let realignTimer: number | null = null

/** 最新一轮的顶边离容器顶多远（null = 还没有任何一轮） */
function latestOffset(): number | null {
  const body = bodyEl.value
  if (body === null) return null
  // 只认 `.body` 的**直接子**轮次：`.turn` 这个名字在面板里不止一层，
  // 用 querySelectorAll 取"文档顺序最后一个"会拿到别的轮次里的嵌套元素，算出的位置不对。
  const list = Array.from(body.children).filter((el) => el.classList.contains('turn')) as HTMLElement[]
  const last = list[list.length - 1]
  if (last === undefined) return null
  return last.getBoundingClientRect().top - body.getBoundingClientRect().top
}

/**
 * 反复把最新一轮的顶边对齐到容器顶，直到就位且内容不再长高（最多 6 次、约 1 秒）。
 *
 * 为什么要反复：回答落地后内容还在继续长高 —— 事实卡、趋势小图、以及**异步重读的阶段卡**
 * 都是渲染完才撑开高度的；只对齐一次等于算在"还没长起来"的那一刻，等长完最新一轮已经被顶出视野。
 *
 * 为什么**不用平滑滚动**：布局持续变化时平滑动画会被打断在半路（实测滚了等于没滚）。
 * 瞬时对齐反而稳定；这也顺带满足"减少动态效果"（没有动画可减）。
 */
const PIN_MAX_ATTEMPTS = 10
const PIN_INTERVAL_MS = 250

function pinLatest(attempt = 0, lastHeight = -1, stableRounds = 0): void {
  if (realignTimer !== null) {
    window.clearTimeout(realignTimer)
    realignTimer = null
  }
  const body = bodyEl.value
  if (body === null) return
  const offset = latestOffset()
  const height = body.scrollHeight
  if (offset !== null) {
    const max = Math.max(0, height - body.clientHeight)
    body.scrollTop = Math.min(Math.max(0, body.scrollTop + offset - 8), max)
  }
  // 就位（顶边贴近容器顶）**且连续两次高度都没变**才算稳定：
  // 只看"这一轮算出的目标一样"会误判 —— 趋势小图和异步重读的阶段卡是稍后才撑开高度的。
  const stable = offset !== null && offset <= 12 && height === lastHeight
  const rounds = stable ? stableRounds + 1 : 0
  if (attempt >= PIN_MAX_ATTEMPTS || rounds >= 2) return
  realignTimer = window.setTimeout(() => pinLatest(attempt + 1, height, rounds), PIN_INTERVAL_MS)
}

watch(latestKey, () => {
  void nextTick(() => pinLatest())
})

/** 窄屏判定只负责布局与 Esc 范围；显式跳转在所有宽度下都让出目标页面。 */
const narrow = ref(false)
let media: MediaQueryList | null = null
const syncNarrow = (): void => {
  narrow.value = media?.matches ?? false
}

onMounted(() => {
  media = window.matchMedia('(max-width: 900px)')
  syncNarrow()
  media.addEventListener('change', syncNarrow)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  if (realignTimer !== null) window.clearTimeout(realignTimer)
  media?.removeEventListener('change', syncNarrow)
  document.removeEventListener('keydown', onDocumentKeydown)
})

/** 打开时把焦点放进面板；关闭时由壳层负责还给入口按钮。 */
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    await nextTick()
    panelEl.value?.querySelector<HTMLElement>('input, button')?.focus()
  },
)

/** Esc：焦点在面板内时总是关闭；全屏形态下面板盖住页面，因此整页都生效。 */
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !props.open) return
  const inside = panelEl.value?.contains(event.target as Node) ?? false
  if (!inside && !narrow.value) return
  event.preventDefault()
  emit('close')
}

async function onNavigate(link: AskLink): Promise<void> {
  try {
    const reached = await navigateFromAnswer({ router, link, close: () => emit('close') })
    if (!reached) assistant.notice = '页面跳转已取消，请重试；当前回答已保留。'
  } catch {
    assistant.notice = '页面暂时无法打开，请重试；当前回答已保留。'
  }
}

/** 只响应显式演示任务产生的白名单导航；普通问题没有导航序号。 */
watch(() => director.navigationSeq, () => {
  const link = director.link
  if (link !== null && !director.cancelled) void router.push({ path: link.path, query: link.query })
})

async function onChoose(candidate: AskCandidate, question: string): Promise<void> {
  await assistant.chooseCandidate(candidate, question)
}

/**
 * 视觉证据卡上的操作（看裂缝区域 / 看完好墙面 / 自己框选）：
 * 交给会话层**就地更新**那条回答的影像部分，不新增一轮问答。
 */
function onVisual(turnId: string, action: VisualAction): void {
  void assistant.applyVisual(turnId, action)
}

function onRefresh(): void {
  void assistant.refresh()
}

/** 上下文提示：写清当前沿用哪个对象，并给"清除上下文"的出口。 */
const contextHint = computed(() => {
  if (selectedPoint.value !== undefined && Object.keys(assistant.pageContext).length > 0) return `页面选中：${selectedPoint.value.code} · 上轮对象：${assistant.contextLabel || '无'}；说“刚才那个”可沿用上轮。`
  if (assistant.contextLabel !== '') return `当前上下文：${assistant.contextLabel}`
  if (assistant.context.pointId !== undefined) return '当前上下文：已选测点'
  if (assistant.context.eventId !== undefined) return '当前上下文：已选事件'
  return '未选定对象：追问「它怎么样」前请先在测点卡或事件详情点「问小瞳」'
})

const paused = computed(() => alerts.activeStrong !== null)
</script>

<template>
  <Transition name="assistant-slide">
  <aside
    v-if="open"
    id="assistant-panel"
    ref="panelEl"
    class="panel"
    :class="{ 'panel--full': narrow }"
    aria-label="问筑瞳"
  >
    <AssistantHeader :context="contextHint" :active="preparation.active" :paused="paused" @close="emit('close')" />

    <div ref="bodyEl" class="body" :class="{ 'body--empty': assistant.turns.length === 0 }">
      <p v-if="assistant.notice !== ''" class="notice notice--brand notice--tight">{{ assistant.notice }}</p>
      <GuideCard @navigate="onNavigate" />
      <TaskStatusCard />

      <AssistantWelcome v-if="assistant.turns.length === 0" :questions="exampleQuestions" :scope-note="exampleScope"
        :busy="assistant.busy" :paused="paused" @ask="assistant.ask($event)" />

      <div v-for="(turn, index) in assistant.turns" :key="turn.id" class="turn">
        <button
          v-if="isCollapsed(turn.id, index)"
          type="button"
          class="turn-row"
          @click="toggleTurn(turn.id, index)"
        >
          <span class="turn-q">{{ turn.question }}</span>
          <span class="turn-more">展开回答</span>
        </button>
        <template v-else>
          <button
            v-if="assistant.turns.length > 1"
            type="button"
            class="turn-row"
            @click="toggleTurn(turn.id, index)"
          >
            <span class="turn-q">{{ turn.question }}</span>
            <span class="turn-more">收起</span>
          </button>
          <AskAnswer
            :turn="turn"
            :active="index === assistant.turns.length - 1"
            @navigate="onNavigate"
            @choose="onChoose($event, turn.question)"
            @visual="onVisual"
          />
        </template>
      </div>
    </div>

    <AskComposer :busy="assistant.busy" :examples="exampleQuestions" :scope-note="exampleScope"
      :show-suggestions="assistant.turns.length > 0" :asked-questions="assistant.turns.map(turn => turn.question)"
      @ask="assistant.ask($event)" @refresh="onRefresh" />
  </aside>
  </Transition>
</template>

<style scoped src="./presentation/styles/panel.css"></style>
