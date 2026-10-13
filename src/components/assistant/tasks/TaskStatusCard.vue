<script setup lang="ts">
import { useDirectorStore } from '@/assistant/director/state'
const task = useDirectorStore()
</script>

<template>
  <section v-if="task.busy" class="task-status" aria-label="任务执行状态" aria-live="polite">
    <span class="running" aria-hidden="true" />
    <div><h3>{{ task.title }}</h3><p>{{ task.detail }}</p><p role="status">{{ task.progress }}</p></div>
  </section>
</template>

<style scoped>
.task-status { display: flex; align-items: start; gap: 12px; padding: 16px; border: 1px solid var(--brand-200); border-radius: var(--r-md); background: var(--paper); }
h3 { margin: 0; font-size: 15px; color: var(--text-1); }
p { margin: 6px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-2); }
.running { flex: none; width: 14px; height: 14px; margin-top: 3px; border: 2px solid var(--brand-200); border-top-color: var(--brand-600); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .running { animation: none; } }
</style>
