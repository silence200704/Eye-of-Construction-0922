<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import AppButton from '@/components/ui/AppButton.vue'
import { watchBackendIdentity } from '@/core/app/backendAccess'

const emit = defineEmits<{ authenticated: [] }>()
const auth = useBackendSessionStore()
const restoring = ref(true)
watchBackendIdentity(() => auth.user, () => emit('authenticated'))

async function restore(): Promise<void> {
  if (restoring.value && auth.busy) return
  restoring.value = true
  try { await auth.initialize() }
  finally { restoring.value = false }
}

onMounted(restore)
watch(() => auth.user, (next, previous) => { if (!next && previous) void restore() })
</script>

<template>
  <slot v-if="auth.user" />
  <div v-else class="access-screen">
    <p v-if="restoring" role="status">正在连接演示工作台…</p>
    <section v-else aria-label="连接状态">
      <p role="alert">{{ auth.message || '暂时无法连接演示服务' }}</p>
      <AppButton @click="restore">重新连接</AppButton>
    </section>
  </div>
</template>

<style scoped>
.access-screen { min-height: 100%; display: grid; place-items: center; padding: 24px; background: var(--page, #f3f6f5); }
</style>
