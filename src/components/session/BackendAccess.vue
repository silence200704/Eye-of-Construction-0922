<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import BackendLogin from './BackendLogin.vue'

const emit = defineEmits<{ authenticated: [] }>()
const auth = useBackendSessionStore()
const restoring = ref(true)

async function restore(): Promise<void> {
  await auth.restore()
  restoring.value = false
  if (auth.user) emit('authenticated')
}

onMounted(restore)
</script>

<template>
  <slot v-if="auth.user" />
  <div v-else class="access-screen">
    <p v-if="restoring" role="status">正在核验登录状态…</p>
    <BackendLogin v-else @authenticated="emit('authenticated')" />
  </div>
</template>

<style scoped>
.access-screen { min-height: 100%; display: grid; place-items: center; padding: 24px; background: var(--page, #f3f6f5); }
</style>
