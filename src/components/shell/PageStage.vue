<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
const route = useRoute()
const stage = ref<HTMLElement | null>(null)
watch(() => route.path, async () => {
  await nextTick()
  const content = stage.value?.parentElement
  if (content) content.scrollTop = 0
})
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <!-- Query changes select business objects; they must not recreate the page or its 3D scene. -->
    <div v-if="Component" ref="stage" :key="route.path" class="page-stage">
      <component :is="Component" />
    </div>
  </RouterView>
</template>

<style scoped>
.page-stage { min-width: 0; animation: page-arrive 180ms ease-out; }
/* No leaving-page wait: navigation mounts its destination immediately, even in a throttled tab. */
@keyframes page-arrive { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .page-stage { animation: none; }
}
</style>
