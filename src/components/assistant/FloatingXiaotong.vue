<script setup lang="ts">
/**
 * 悬浮小瞳入口（替换原来的顶栏按钮）。
 *
 * 交互口径参考 `hnuahe_yingxin-main/frontend/src/composables/useDrag.ts`：
 * 位移超过阈值才算拖动，否则按轻点处理；元素始终整体留在视口内，窗口变化后重新夹紧。
 * 这里只取这三条交互约定，**不照搬**它的遮罩、联网问答、语音播报与"AI 在线"文案。
 *
 * 键盘同样可操作：Tab 聚焦、Enter/Space 打开、方向键微调位置（Shift 走大步）。
 * 位置存在本机偏好里，刷新后还在原处；存坏了就退回默认落点。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { MascotState } from '@/assistant/session'
import {
  ENTRY_SIZE,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  POSITION_KEY,
  clampPosition,
  defaultPosition,
  dockPosition,
  isTap,
  nudge,
  parseStoredPosition,
  tapThreshold,
  type Point,
} from './floating'
import XiaotongAvatar from './XiaotongAvatar.vue'

const props = withDefaults(defineProps<{ state: MascotState; paused?: boolean }>(), { paused: false })

const emit = defineEmits<{ activate: [] }>()

/** 尺寸只在这里定义一次：逻辑（夹紧/停靠）与样式（CSS 变量）都读它 */
const SIZE = { width: ENTRY_SIZE, height: ENTRY_SIZE }

const position = ref<Point>({ x: 0, y: 0 })
const dragging = ref(false)
const hovering = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const narrow = ref(false)
let media: MediaQueryList | null = null
let dragMoved = false
let dragStart = { x: 0, y: 0, bx: 0, by: 0 }

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

function reclamp(): void {
  position.value = clampPosition(position.value, viewport(), SIZE)
}

function persist(): void {
  try {
    localStorage.setItem(POSITION_KEY, JSON.stringify(position.value))
  } catch {
    // 存不进去只影响下次打开的位置，不阻断使用
  }
}

function onPointerDown(event: PointerEvent): void {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  dragging.value = true
  dragMoved = false
  dragStart = { x: event.clientX, y: event.clientY, bx: position.value.x, by: position.value.y }
  rootEl.value?.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return
  const moved = { x: event.clientX, y: event.clientY }
  if (!isTap({ x: dragStart.x, y: dragStart.y }, moved, tapThreshold(narrow.value))) dragMoved = true
  if (!dragMoved) return
  position.value = clampPosition({ x: dragStart.bx + moved.x - dragStart.x, y: dragStart.by + moved.y - dragStart.y }, viewport(), SIZE)
}

/**
 * 松手：拖过就不打开；拖动过的那次松手会**靠边停靠**（贴向更近的一侧），
 * 免得停在正文中间挡住别人。轻点则只请求打开面板。
 */
function onPointerUp(event: PointerEvent): void {
  if (!dragging.value) return
  const moved = { x: event.clientX, y: event.clientY }
  const wasTap = isTap({ x: dragStart.x, y: dragStart.y }, moved, tapThreshold(narrow.value)) && !dragMoved
  dragging.value = false
  rootEl.value?.releasePointerCapture(event.pointerId)
  if (wasTap) {
    emit('activate')
    return
  }
  position.value = dockPosition(position.value, viewport(), SIZE)
  persist()
}

function onPointerCancel(): void {
  dragging.value = false
  reclamp()
  persist()
}

/** 悬停：点亮镜头高光；拖拽中不重复触发 */
function onPointerEnter(): void {
  hovering.value = true
}

function onPointerLeave(): void {
  hovering.value = false
}

/**
 * 键盘激活显式处理 Enter / Space。
 *
 * 不依赖浏览器"按键 → 合成 click"的默认动作：那条路在自动化运行时里不成立，
 * 也让"键盘能不能用"变成只能靠真机碰运气的事。
 * 代价是要处理重复触发 —— 真实浏览器按下回车时，keydown 之后还会补一个 `detail === 0` 的 click。
 */
let keyActivatedAt = 0

function onKeyActivate(): void {
  keyActivatedAt = Date.now()
  emit('activate')
}

function onClick(event: MouseEvent): void {
  // 指针点击已经在 pointerup 里处理
  if (event.detail !== 0) return
  // 紧随键盘激活而来的那次合成点击跳过，避免一次按键开两次
  if (Date.now() - keyActivatedAt < 400) return
  emit('activate')
}

/** 方向键微调：键盘用户不依赖指针也能把它挪开。 */
function onKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP
  const delta = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } }[event.key]
  if (delta === undefined) return
  event.preventDefault()
  position.value = nudge(position.value, delta, viewport(), SIZE)
  persist()
}

function syncNarrow(): void {
  narrow.value = media?.matches ?? false
  reclamp()
}

onMounted(() => {
  media = window.matchMedia('(max-width: 900px)')
  const stored = parseStoredPosition(localStorage.getItem(POSITION_KEY))
  position.value = stored === null ? defaultPosition(viewport(), SIZE) : clampPosition(stored, viewport(), SIZE)
  syncNarrow()
  media.addEventListener('change', syncNarrow)
  window.addEventListener('resize', reclamp)
})

onBeforeUnmount(() => {
  media?.removeEventListener('change', syncNarrow)
  window.removeEventListener('resize', reclamp)
})

/** 关闭面板后由壳层把焦点交回这里 */
function focus(): void {
  void nextTick(() => rootEl.value?.focus())
}

defineExpose({ focus })

const style = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  '--entry-size': `${ENTRY_SIZE}px`,
}))

/** 拖动中与红色预警弹窗期间都要暂停装饰动画 */
const paused = computed(() => props.paused || dragging.value)

/** 状态文字：减少动态效果时它是唯一的状态说明，平时也在非待机态给一句 */
const stateText = computed(() => {
  if (props.state === 'searching') return '检索中…'
  if (props.state === 'found') return '找到证据'
  if (props.state === 'empty') return '没有可用数据'
  return ''
})

const restLabel = computed(() => (stateText.value === '' ? '问筑瞳' : stateText.value))
</script>

<template>
  <button
    ref="rootEl"
    class="bubble"
    :class="{ 'bubble--dragging': dragging }"
    :data-state="state"
    :style="style"
    type="button"
    aria-label="问筑瞳：打开本地数据问答"
    aria-haspopup="dialog"
    title="问筑瞳（轻点打开，可拖动）"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @keydown="onKeydown"
    @keydown.enter.prevent="onKeyActivate"
    @keydown.space.prevent="onKeyActivate"
    @click="onClick"
  >
    <XiaotongAvatar :state="state" :paused="paused" :hover="hovering" :size="ENTRY_SIZE - 12" />
    <span class="bubble-hint" aria-hidden="true">{{ restLabel }}</span>
  </button>
</template>

<style scoped>
.bubble {
  position: fixed;
  /* 压在面板(50)/抽屉(55)/弹窗(60)之下：红色预警弹窗必须完整盖住它 */
  z-index: 45;
  width: var(--entry-size);
  height: var(--entry-size);
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--brand-200);
  border-radius: 50%;
  background: var(--paper);
  box-shadow: 0 6px 18px rgba(9, 18, 23, 0.18);
  cursor: grab;
  touch-action: none;
  /* 停靠时让位置变化看得出来；拖动中关掉，免得跟手迟滞 */
  transition: left 0.18s ease, top 0.18s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.bubble--dragging { transition: border-color 0.15s ease, box-shadow 0.15s ease; }

.bubble:hover { border-color: var(--brand-500); box-shadow: 0 8px 22px rgba(20, 134, 149, 0.28); }
.bubble:focus-visible { outline: none; box-shadow: var(--focus-ring), 0 6px 18px rgba(9, 18, 23, 0.18); border-color: var(--brand-500); }
.bubble--dragging { cursor: grabbing; }

/* 悬停/聚焦时才显示文字，平时不遮地图；不影响形象本身的尺寸约定 */
.bubble-hint {
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--brand-700);
  color: #fff;
  font-size: 10.5px;
  line-height: 1.5;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.bubble:hover .bubble-hint,
.bubble:focus-visible .bubble-hint { opacity: 1; }

/* 检索中/找到/无数据：状态文字直接显示出来，减少动态效果时它就是唯一的状态说明 */
.bubble[data-state='searching'] .bubble-hint,
.bubble[data-state='found'] .bubble-hint,
.bubble[data-state='empty'] .bubble-hint { opacity: 1; }

@media (prefers-reduced-motion: reduce) {
  .bubble, .bubble-hint { transition: none; }
}
</style>
