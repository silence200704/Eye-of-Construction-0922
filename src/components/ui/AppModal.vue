<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    sub?: string
    width?: number
    closeOnBackdrop?: boolean
  }>(),
  { sub: '', width: 720, closeOnBackdrop: true },
)

const emit = defineEmits<{ close: [] }>()

const panelRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function focusables(): HTMLElement[] {
  const panel = panelRef.value
  if (panel === null) return []
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('disabled') && el.offsetParent !== null,
  )
}

/** Esc 关闭，Tab 在弹窗内循环，关闭后把焦点还给打开它的元素。 */
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close')
    return
  }
  if (event.key !== 'Tab') return
  const list = focusables()
  if (list.length === 0) return
  const first = list[0]
  const last = list[list.length - 1]
  const active = document.activeElement as HTMLElement | null
  const inside = active !== null && panelRef.value?.contains(active) === true
  if (event.shiftKey && (!inside || active === first)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault()
    first.focus()
  }
}

async function bind(active: boolean): Promise<void> {
  if (active) {
    previouslyFocused = document.activeElement as HTMLElement | null
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    await nextTick()
    const list = focusables()
    ;(list[0] ?? panelRef.value)?.focus()
    return
  }
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
  if (previouslyFocused !== null && document.contains(previouslyFocused)) previouslyFocused.focus()
  previouslyFocused = null
}

watch(() => props.open, (open) => void bind(open))

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click.self="closeOnBackdrop && emit('close')">
      <div
        ref="panelRef"
        class="panel"
        :style="{ maxWidth: `${width}px` }"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <header class="panel-head">
          <div>
            <h3 class="panel-title">{{ title }}</h3>
            <p v-if="sub" class="panel-sub">{{ sub }}</p>
          </div>
          <button class="panel-close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="panel-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="panel-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(9, 18, 23, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 20px;
  overflow-y: auto;
  animation: overlay-in 0.12s ease;
}

.panel:focus {
  outline: none;
}

.panel {
  width: 100%;
  background: var(--paper);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 96px);
  animation: panel-in 0.14s ease;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--line);
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
}

.panel-sub {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 4px;
  line-height: 1.5;
}

.panel-close {
  border: 0;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: var(--text-3);
  cursor: pointer;
  padding: 0 2px;
}

.panel-close:hover {
  color: var(--text);
}

.panel-body {
  padding: 18px 22px;
  overflow-y: auto;
}

.panel-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--line);
}

/*
 * 用纯 CSS 动画代替 Vue <Transition>：弹窗开关不依赖 transitionend 与
 * requestAnimationFrame，标签页被节流时也不会残留在中间状态而关不掉。
 */
@keyframes overlay-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
