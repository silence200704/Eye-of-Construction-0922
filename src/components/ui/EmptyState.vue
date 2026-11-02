<script setup lang="ts">
defineProps<{
  title: string
  sub?: string
  loading?: boolean
}>()
</script>

<template>
  <div class="empty" :aria-busy="loading || undefined" :class="{ 'empty--loading': loading }">
    <svg class="empty-illustration" width="82" height="72" viewBox="0 0 100 80" fill="none" aria-hidden="true">
      <ellipse cx="50" cy="68" rx="35" ry="7" fill="#dbe9d9" />
      <path d="m20 31 30-14 30 14-30 14Z" fill="#bfd8c4" />
      <path d="m20 31 30 14v26L20 57Z" fill="#ecf2e8" stroke="#afc8b2" />
      <path d="m50 45 30-14v26L50 71Z" fill="#d9e9d9" stroke="#afc8b2" />
      <path d="m31 35 19 9 19-9M50 44v26" stroke="#9ab49b" />
      <rect x="39" y="10" width="25" height="31" rx="4" fill="#fdfcf0" stroke="#9eb49b" transform="rotate(8 39 10)" />
      <path d="m46 20 12 2m-13 5 11 2" stroke="#a9bca2" stroke-width="2" stroke-linecap="round" />
      <circle cx="80" cy="15" r="5" fill="#edcf8f" /><path d="M14 19v8m-4-4h8M83 41v6m-3-3h6" stroke="#a4b798" stroke-linecap="round" />
    </svg>
    <div class="empty-title">{{ title }}</div>
    <div v-if="sub" class="empty-sub">{{ sub }}</div>
    <slot />
  </div>
</template>

<style scoped>
.empty-illustration { flex: none; margin-bottom: 4px; }
.empty--loading .empty-illustration { animation: empty-breathe 1.4s ease-in-out infinite alternate; }
@keyframes empty-breathe { to { opacity: .5; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .empty--loading .empty-illustration { animation: none; } }
</style>
