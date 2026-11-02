<script setup lang="ts">
/** 主入口下的细分页面：路由照旧，用户从工作台内一眼找到趋势、影像、工单等功能。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { workspaceOf } from './navGroups'

const route = useRoute()
const workspace = computed(() => workspaceOf(route.path))
const nav = ref<HTMLElement | null>(null)
const tile = ref<HTMLElement | null>(null)
let resize: ResizeObserver | null = null
let observed: HTMLElement | null = null
let animation: Animation | null = null

function placeTile(): void {
  const root = nav.value
  const indicator = tile.value
  if (observed !== root) {
    if (observed) resize?.unobserve(observed)
    if (root) resize?.observe(root)
    observed = root
  }
  const active = root?.querySelector<HTMLElement>('.feature-link--active')
  if (!root || !indicator || !active) return
  const previous = indicator.getBoundingClientRect()
  const oldLeft = previous.left - root.getBoundingClientRect().left + root.scrollLeft - root.clientLeft
  const left = active.offsetLeft
  const width = active.offsetWidth
  animation?.cancel()
  indicator.style.width = `${width}px`
  indicator.style.transform = `translateX(${left}px)`
  root.classList.add('feature-links--ready')
  if (previous.width === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  animation = indicator.animate([
    { transform: `translateX(${oldLeft}px) scaleX(${previous.width / width})` },
    { transform: `translateX(${left}px) scaleX(1)` },
  ], { duration: 190, easing: 'cubic-bezier(.22,1,.36,1)' })
}

watch(() => route.path, async () => { await nextTick(); placeTile() })
onMounted(() => { resize = new ResizeObserver(placeTile); placeTile() })
onBeforeUnmount(() => { resize?.disconnect(); animation?.cancel() })

function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <nav v-if="workspace && workspace.tabs.length > 1" ref="nav" class="feature-links" aria-label="当前工作台功能">
    <span ref="tile" class="feature-indicator" aria-hidden="true" />
    <span class="feature-label">当前工作台</span>
    <RouterLink v-for="tab in workspace.tabs" :key="tab.to" :to="tab.to === route.path ? route.fullPath : tab.to"
      class="feature-link" :class="{ 'feature-link--active': isActive(tab.to) }"
      :aria-current="isActive(tab.to) ? 'page' : undefined">
      {{ tab.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.feature-links {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 22px;
  padding: 5px 6px;
  overflow-x: auto;
  border: 1px solid #e0e7de;
  border-radius: 16px;
  background: #f9fcf5b3;
  width: fit-content;
  max-width: 100%;
}
.feature-label { flex: none; padding: 0 11px 0 5px; color: var(--text-3); font-size: 11px; font-weight: 700; white-space: nowrap; }
.feature-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  padding: 6px 13px;
  border-radius: var(--r-sm);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  transition: background-color 140ms ease, color 140ms ease;
}
.feature-link:hover { color: var(--brand-700); background: var(--brand-050); }
.feature-link:focus-visible { outline: 2px solid var(--brand-500); outline-offset: -2px; }
.feature-link--active { color: var(--brand-700); background: var(--paper); box-shadow: 0 2px 6px #25433712; }
.feature-indicator { position: absolute; top: 5px; bottom: 5px; left: 0; width: 0; transform-origin: left center; border-radius: var(--r-sm); background: var(--paper); box-shadow: 0 2px 6px #25433712; pointer-events: none; }
.feature-links--ready .feature-link--active { background: transparent; box-shadow: none; }
@media (max-width: 600px) { .feature-label { display: none; }.feature-link { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .feature-link { transition: none; } }
</style>
