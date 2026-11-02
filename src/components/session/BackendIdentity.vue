<script setup lang="ts">
import { ref } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import BackendIdentityPicker from './BackendIdentityPicker.vue'
import DatasetSwitch from './DatasetSwitch.vue'

defineProps<{ disabled?: boolean }>()
const auth = useBackendSessionStore()
const open = ref(false)

</script>

<template>
  <AppButton :disabled="disabled" :aria-label="`${auth.user?.roleLabel || '演示身份'} · 切换身份`" @click="open = true">
    <span class="identity-role">{{ auth.user?.roleLabel || '演示身份' }}</span><span class="identity-switch"> · 切换身份</span>
  </AppButton>
  <AppModal :open="open" title="切换演示身份" sub="选择本次演示使用的身份，操作记录将保留对应人员与角色" :width="560" @close="open = false">
    <BackendIdentityPicker @selected="open = false" />
    <DatasetSwitch />
    <template #footer><AppButton @click="open = false">返回</AppButton></template>
  </AppModal>
</template>

<style scoped>
.identity-role { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 600px) { .identity-role { max-width: 88px; }.identity-switch { display: none; } }
</style>
