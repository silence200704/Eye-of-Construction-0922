<script setup lang="ts">
/** 主入口下的细分页面：路由照旧，用户从工作台内一眼找到趋势、影像、工单等功能。 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { workspaceOf } from './navGroups'

const route = useRoute()
const workspace = computed(() => workspaceOf(route.path))

function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <nav v-if="workspace && workspace.tabs.length > 1" class="feature-links" aria-label="当前工作台功能">
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
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 18px;
  padding: 5px 6px;
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--canvas-deep);
}
.feature-label { flex: none; padding: 0 11px 0 5px; color: var(--text-3); font-size: 11px; font-weight: 700; white-space: nowrap; }
.feature-link {
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
.feature-link--active { color: var(--brand-700); background: var(--paper); box-shadow: 0 1px 3px rgba(9, 18, 23, .08); }
@media (max-width: 600px) { .feature-label { display: none; } }
@media (prefers-reduced-motion: reduce) { .feature-link { transition: none; } }
</style>
