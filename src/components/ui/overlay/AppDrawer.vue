<script setup lang="ts">
/**
 * 右侧详情抽屉。
 *
 * 与 AppModal 的区别是**刻意做成非模态**：不加遮罩、不锁页面滚动。
 * 详情从右侧出来的同时，左边列表仍然可以继续滚动、继续点别的行换详情 ——
 * 这正是"不跳页、列表上下文不丢"的关键；加一层遮罩就把这条能力抵消了。
 *
 * Esc 关闭；打开时记住焦点来源、关闭后还回去，键盘用户不会掉到页面开头。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ open: boolean; title: string; sub?: string; width?: number }>(), {
  sub: '',
  width: 540,
})

const emit = defineEmits<{ close: [] }>()

const panelRef = ref<HTMLElement | null>(null)
let previouslyFocused: HTMLElement | null = null

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKey)
      await nextTick()
      panelRef.value?.focus()
      return
    }
    document.removeEventListener('keydown', onKey)
    // 关闭后把焦点还给打开它的那一行（列表没被卸载，元素还在）
    if (previouslyFocused !== null && document.contains(previouslyFocused)) previouslyFocused.focus()
    previouslyFocused = null
  },
)

onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <aside
      v-if="open"
      ref="panelRef"
      class="drawer"
      :style="{ '--drawer-w': `${width}px` }"
      role="dialog"
      aria-modal="false"
      tabindex="-1"
    >
      <header class="drawer-head">
        <div>
          <h3 class="drawer-title">{{ title }}</h3>
          <p v-if="sub" class="drawer-sub">{{ sub }}</p>
        </div>
        <button class="drawer-close" type="button" aria-label="关闭详情" @click="emit('close')">×</button>
      </header>
      <div class="drawer-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="drawer-foot">
        <slot name="footer" />
      </footer>
    </aside>
  </Teleport>
</template>

<style scoped>
.drawer:focus {
  outline: none;
}

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  /* 窄屏时铺满：inline 宽度写死在样板上会让媒体查询失效，所以走 CSS 变量 */
  width: min(var(--drawer-w, 540px), 100vw);
  z-index: 55;
  background: var(--paper);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow-pop);
  display: flex;
  flex-direction: column;
  animation: drawer-in 0.14s ease;
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--line);
}

.drawer-title {
  font-size: 15px;
  font-weight: 600;
}

.drawer-sub {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 4px;
  line-height: 1.5;
}

.drawer-close {
  border: 0;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  color: var(--text-3);
  cursor: pointer;
  padding: 0 2px;
}

.drawer-close:hover {
  color: var(--text);
}

.drawer-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.drawer-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--line);
}

/* 用纯 CSS 动画代替 <Transition>：标签页被节流时也不会残留在中间状态 */
@keyframes drawer-in {
  from {
    opacity: 0;
    transform: translateX(16px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
