<script setup lang="ts">
import { ref } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import BackendLogin from './BackendLogin.vue'

defineProps<{ disabled?: boolean }>()
const auth = useBackendSessionStore()
const open = ref(false)

async function logout(): Promise<void> {
  open.value = false
  await auth.logout()
}
</script>

<template>
  <AppButton :disabled="disabled" @click="open = true">{{ auth.user?.name || '登录账号' }} · {{ auth.user?.roleLabel }}</AppButton>
  <AppModal :open="open" title="切换测试账号" sub="账号由服务端提供，操作权限随登录账号切换" :width="560" @close="open = false">
    <BackendLogin compact @authenticated="open = false" />
    <template #footer><AppButton @click="open = false">返回</AppButton><AppButton @click="logout">退出登录</AppButton></template>
  </AppModal>
</template>
