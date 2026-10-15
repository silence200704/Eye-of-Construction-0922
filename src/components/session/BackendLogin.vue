<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import AppButton from '@/components/ui/AppButton.vue'

defineProps<{ compact?: boolean }>()
const emit = defineEmits<{ authenticated: [] }>()
const auth = useBackendSessionStore()
const username = ref('demo-safety')
const password = ref('')

async function select(accountId: string): Promise<void> {
  if (await auth.select(accountId)) emit('authenticated')
}

async function login(): Promise<void> {
  if (await auth.login(username.value.trim(), password.value)) emit('authenticated')
  password.value = ''
}

onMounted(auth.loadAccounts)
</script>

<template>
  <section class="backend-login" :class="{ compact }" aria-label="后端账号登录">
    <header v-if="!compact">
      <span class="eyebrow">筑瞳 · 校园建筑健康监测</span>
      <h1>进入演示工作台</h1>
      <p class="muted">选择测试账号，查看对应角色的任务与处理入口。</p>
    </header>
    <div v-if="auth.accounts.length" class="account-list">
      <button v-for="account in auth.accounts" :key="account.id" type="button"
        class="account" :disabled="auth.busy" @click="select(account.id)">
        <b>{{ account.roleLabel }}</b><span>{{ account.name }}</span>
      </button>
    </div>
    <form class="password-login" @submit.prevent="login">
      <label>账号<input v-model="username" name="username" autocomplete="username" required /></label>
      <label>密码<input v-model="password" name="password" type="password" autocomplete="current-password" required /></label>
      <AppButton variant="primary" type="submit" :disabled="auth.busy">{{ auth.busy ? '正在连接…' : '账号密码登录' }}</AppButton>
    </form>
    <p v-if="auth.message" role="alert" class="notice notice--bad">{{ auth.message }}</p>
    <AppButton v-if="!auth.accounts.length" :disabled="auth.busy" @click="auth.loadAccounts">重新连接</AppButton>
  </section>
</template>

<style scoped>
.backend-login { width: min(100%, 560px); padding: 32px; background: var(--surface, #fff); border: 1px solid var(--line, #dce2e5); border-radius: var(--r-lg, 16px); }
.compact { padding: 0; border: 0; }
.eyebrow { color: var(--brand-600); font-size: 12px; }
h1 { margin: 10px 0; font-size: 26px; }
.account-list { display: grid; gap: 8px; margin: 22px 0; }
.account { display: flex; justify-content: space-between; gap: 12px; padding: 12px 14px; background: transparent; border: 1px solid var(--line, #dce2e5); border-radius: 8px; text-align: left; cursor: pointer; }
.account:hover { border-color: var(--brand-600); }
.account span { color: var(--ink-500, #64767f); font-size: 12px; }
.password-login { display: grid; gap: 12px; margin: 20px 0; }
label { display: grid; gap: 6px; font-size: 13px; }
@media (max-width: 600px) { .backend-login { padding: 20px; } .compact { padding: 0; } .account { flex-direction: column; gap: 4px; } }
</style>
