<script setup lang="ts">
import { ref } from 'vue'
import { useBackendSessionStore } from '@/stores/backend/session'
import AppModal from '@/components/ui/AppModal.vue'
import AppButton from '@/components/ui/AppButton.vue'
import BackendIdentityPicker from './BackendIdentityPicker.vue'

defineProps<{ disabled?: boolean }>()
const auth = useBackendSessionStore()
const open = ref(false)

</script>

<template>
  <AppButton :disabled="disabled" @click="open = true">{{ auth.user?.roleLabel || '演示身份' }} · 切换身份</AppButton>
  <AppModal :open="open" title="切换演示身份" sub="选择本次演示使用的身份，操作记录将保留对应人员与角色" :width="560" @close="open = false">
    <BackendIdentityPicker @selected="open = false" />
    <template #footer><AppButton @click="open = false">返回</AppButton></template>
  </AppModal>
</template>
