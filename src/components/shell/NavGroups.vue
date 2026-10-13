<script setup lang="ts">
/**
 * 常驻分区标题 + 少量主入口；窄屏用同一组入口横向展示。
 * 标题是 h2，不可点击；细分页面由 FeatureLinks 负责。
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { NAV_GROUPS, groupOf, primaryOf } from './navGroups'

defineProps<{ compact?: boolean }>()
const route = useRoute()
const activeGroup = computed(() => groupOf(route.path))
const activePrimary = computed(() => primaryOf(route.path))
</script>

<template>
  <nav v-if="compact" class="nav nav--compact" aria-label="窄屏主导航">
    <RouterLink
      v-for="item in NAV_GROUPS.flatMap((group) => group.items)"
      :key="item.to"
      :to="item.to"
      class="nav-item"
      :class="{ 'nav-item--active': activePrimary === item.to }"
      :aria-current="activePrimary === item.to ? 'page' : undefined"
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
        class="nav-item"
        :class="{ 'nav-item--active': activePrimary === item.to }"
        :aria-current="activePrimary === item.to ? 'page' : undefined"
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
.nav { display: grid; gap: 0; min-height: 0; overflow-y: auto; padding: 6px 0 14px; }
.nav-group { display: grid; gap: 4px; padding: 16px 0 12px; }
.nav-group-head {
  margin: 0 0 3px;
  padding: 3px 12px;
  color: #9fb5be;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.nav-group-head--on { color: #68c7d1; }
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px 10px;
  border-left: 3px solid transparent;
  border-radius: var(--r-sm);
  color: #d4e0e5;
  font-size: 13.5px;
  text-decoration: none;
  transition: background-color 140ms ease, color 140ms ease;
}
.nav-item:hover { background: rgba(255, 255, 255, 0.09); color: #fff; }
.nav-item:focus-visible { outline: 2px solid #8ddde3; outline-offset: -2px; }
.nav-item--active { background: var(--brand-700); border-left-color: #9ff2f3; color: #fff; font-weight: 700; }
.nav--compact { display: flex; gap: 8px; padding: 8px 16px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; background: var(--ink-900); }
.nav--compact::-webkit-scrollbar { display: none; }
.nav--compact .nav-item { min-height: 40px; padding: 7px 11px; white-space: nowrap; flex: none; }
@media (prefers-reduced-motion: reduce) { .nav-item { transition: none; } }
</style>
