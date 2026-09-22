<script setup lang="ts">
defineProps<{
  items: { label: string; value: string; mono?: boolean; wide?: boolean; muted?: boolean }[]
  columns?: 1 | 2 | 3
}>()
</script>

<template>
  <dl class="kv" :style="{ '--kv-cols': String(columns ?? 2) }">
    <div v-for="item in items" :key="item.label" class="kv-item" :class="{ 'kv-item--wide': item.wide }">
      <dt class="kv-label">{{ item.label }}</dt>
      <dd class="kv-value" :class="{ num: item.mono, muted: item.muted }">{{ item.value }}</dd>
    </div>
  </dl>
</template>

<style scoped>
.kv {
  display: grid;
  grid-template-columns: repeat(var(--kv-cols, 2), minmax(0, 1fr));
  gap: 12px 20px;
  margin: 0;
}

.kv-item--wide {
  grid-column: 1 / -1;
}

.kv-label {
  font-size: 12px;
  color: var(--text-3);
  margin: 0 0 2px;
}

.kv-value {
  margin: 0;
  font-size: 13.5px;
  color: var(--text);
  word-break: break-word;
}

.kv-value.muted {
  color: var(--text-3);
}

@media (max-width: 860px) {
  .kv {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
