<script setup lang="ts">
import { vEdgeLight } from '@/directives/edgeLight'
defineProps<{
  title: string
  sub?: string
  marked?: boolean
  flush?: boolean
}>()
</script>

<template>
  <section v-edge-light class="card" :class="{ 'card--marked': marked, 'card--flush': flush }">
    <div class="card-head">
      <div>
        <h2 class="card-title">{{ title }}</h2>
        <div v-if="sub" class="card-sub">{{ sub }}</div>
      </div>
      <div class="row">
        <slot name="actions" />
      </div>
    </div>
    <slot />
  </section>
</template>

<style scoped>
.card-sub {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 5px;
  line-height: 1.65;
}

/* flush 模式下表格贴边，标题区仍保留内边距 */
.card--flush .card-head {
  padding: 20px 24px 16px;
  margin-bottom: 0;
}
@media (max-width: 600px) {
  .card { padding: 16px; }
  .card--flush { padding: 0; }
  .card-head { flex-wrap: wrap; gap: 10px; }
  .card--flush .card-head { padding: 16px; }
}
</style>
