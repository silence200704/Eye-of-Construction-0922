<script setup lang="ts">
defineProps<{
  tone?: 'gray' | 'brand' | 'red' | 'orange' | 'yellow' | 'green' | 'line'
  text: string
  dot?: boolean
}>()
</script>

<template>
  <span class="tag" :class="`tag--${tone ?? 'gray'}`">
    <i v-if="dot !== false" class="tag-dot" />
    {{ text }}
  </span>
</template>
