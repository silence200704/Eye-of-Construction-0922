<script setup lang="ts">
/**
 * 常驻分区标题 + 少量主入口；窄屏用同一组入口横向展示。
 * 标题是 h2，不可点击；细分页面由 FeatureLinks 负责。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { NAV_GROUPS, groupOf } from './navGroups'

defineProps<{ compact?: boolean }>()
const route = useRoute()
const activeGroup = computed(() => groupOf(route.path))
function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <nav v-if="compact" class="nav nav--compact" aria-label="窄屏主导航">
    <RouterLink
      v-for="item in NAV_GROUPS.flatMap((group) => group.items)"
      :key="item.to"
      :to="item.to"
      :title="item.label"
      :aria-label="item.label"
      class="nav-item"
      :class="{ 'nav-item--active': isActive(item.to) }"
      :aria-current="isActive(item.to) ? 'page' : undefined"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path :d="item.d" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span>{{ item.label }}</span>
    </RouterLink>
  </nav>
  <nav v-else class="nav" aria-label="主导航">
    <section v-for="group in NAV_GROUPS" :key="group.key" class="nav-group" :aria-labelledby="`nav-${group.key}`">
      <h2 :id="`nav-${group.key}`" class="nav-group-head" :class="{ 'nav-group-head--on': activeGroup === group.key }">
        {{ group.label }}
      </h2>
      <RouterLink
        v-for="item in group.items"
        :key="item.to"
        :to="item.to"
        :title="item.label"
        :aria-label="item.label"
        class="nav-item"
        :class="{ 'nav-item--active': isActive(item.to) }"
        :aria-current="isActive(item.to) ? 'page' : undefined"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path :d="item.d" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <span>{{ item.label }}</span>
      </RouterLink>
    </section>
  </nav>
</template>

<style scoped>
.nav { display: grid; gap: 0; min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 0 0 14px; scrollbar-gutter: stable; }
.nav-group { display: grid; gap: 2px; padding: 5px 0 7px; }
.nav-group-head {
  margin: 0 0 3px;
  padding: 3px 12px;
  color: #63766a;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.nav-group-head--on { color: #5d7866; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 33px;
  padding: 5px 12px;
  border: 1px solid transparent;
  border-radius: 13px;
  color: #536b5e;
  font-size: 13px;
  text-decoration: none;
  transition: background-color var(--motion-fast), color var(--motion-fast), transform var(--motion-fast);
}
.nav-item:hover { background: #eaf1e7; color: #244f3f; }
.nav-item:active { transform: scale(.98); }
.nav-item:focus-visible { outline: 2px solid var(--brand-500); outline-offset: -2px; }
.nav-item--active { background: var(--brand-700); border-color: var(--brand-700); color: #fff; font-weight: 600; box-shadow: 0 4px 9px #0b57621a; }
.nav-item--active:hover { background: var(--brand-600); color: white; }
.nav--compact { display: flex; gap: 6px; padding: 8px 16px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; background: #fbfcf8; border-bottom: 1px solid var(--line); }
.nav--compact::-webkit-scrollbar { display: none; }
.nav--compact .nav-item { min-height: 40px; padding: 7px 11px; white-space: nowrap; flex: none; }
@media (prefers-reduced-motion: reduce) { .nav-item { transition: none; transform: none; } }
</style>
