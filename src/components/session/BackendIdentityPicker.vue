<script setup lang="ts">
import { onMounted } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import AppButton from '@/components/ui/AppButton.vue'

const emit = defineEmits<{ selected: [] }>()
const auth = useBackendSessionStore()
async function select(identityId: string): Promise<void> {
  if (await auth.select(identityId)) emit('selected')
}
onMounted(auth.loadIdentities)
</script>

<template>
  <section aria-label="演示身份选择">
    <div class="identity-list">
      <button v-for="identity in auth.identities" :key="identity.id" type="button"
        class="identity" :aria-pressed="auth.user?.id === identity.id" :disabled="auth.busy" @click="select(identity.id)">
        <b>{{ identity.roleLabel }}</b><span>{{ auth.user?.id === identity.id ? '当前身份' : identity.name }}</span>
      </button>
    </div>
    <p v-if="auth.message" role="alert" class="notice notice--bad">{{ auth.message }}</p>
    <AppButton v-if="!auth.identities.length" :disabled="auth.busy" @click="auth.loadIdentities">重新连接</AppButton>
  </section>
</template>

<style scoped>
.identity-list { display: grid; gap: 8px; }
.identity { display: flex; justify-content: space-between; gap: 12px; padding: 12px 14px; background: transparent; border: 1px solid var(--line, #dce2e5); border-radius: 8px; text-align: left; cursor: pointer; }
.identity:hover, .identity[aria-pressed="true"] { border-color: var(--brand-600); }
.identity span { color: var(--ink-500, #64767f); font-size: 12px; }
@media (max-width: 600px) { .identity { flex-direction: column; gap: 4px; } }
</style>
