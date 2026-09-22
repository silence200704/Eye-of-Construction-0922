<script setup lang="ts">
defineProps<{
  title: string
  sub?: string
  marked?: boolean
  flush?: boolean
}>()
</script>

<template>
  <section class="card" :class="{ 'card--marked': marked, 'card--flush': flush }">
    <div class="card-head">
      <div>
        <div class="card-title">{{ title }}</div>
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
  margin-top: 3px;
}

/* flush 模式下表格贴边，标题区仍保留内边距 */
.card--flush .card-head {
  padding: 16px 20px 12px;
  margin-bottom: 0;
}
</style>
