<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import BackendLogin from './BackendLogin.vue'
import { watchBackendIdentity } from '@/core/app/backendAccess'

const emit = defineEmits<{ authenticated: [] }>()
const auth = useBackendSessionStore()
const restoring = ref(true)
watchBackendIdentity(() => auth.user, () => emit('authenticated'))

async function restore(): Promise<void> {
  await auth.restore()
  restoring.value = false
}

onMounted(restore)
</script>

<template>
  <slot v-if="auth.user" />
  <div v-else class="access-screen">
    <p v-if="restoring" role="status">正在核验登录状态…</p>
    <BackendLogin v-else />
  </div>
</template>

<style scoped>
.access-screen { min-height: 100%; display: grid; place-items: center; padding: 24px; background: var(--page, #f3f6f5); }
</style>
