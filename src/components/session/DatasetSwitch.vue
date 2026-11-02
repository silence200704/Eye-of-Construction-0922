<script setup lang="ts">
import { ref } from 'vue'
import { DATASET_ID } from '@/api/backend/runtime'
import AppButton from '@/components/ui/AppButton.vue'
import AppModal from '@/components/ui/AppModal.vue'
const open = ref(false)
function switchDataset(): void {
  localStorage.setItem('zhutong-api/dataset-id', DATASET_ID === 'demo-main' ? 'demo-showcase' : 'demo-main')
  location.reload()
}
</script>
<template>
  <div class="dataset-switch">
    <p>当前：{{ DATASET_ID === 'demo-main' ? '主业务集' : '比赛专用演示集' }}。App 与网页请选择同一数据集。</p>
    <AppButton variant="ghost" @click="open = true">切换至{{ DATASET_ID === 'demo-main' ? '比赛演示集' : '主业务集' }}</AppButton>
    <AppModal :open="open" title="切换数据集" sub="页面将重新载入；未提交的网页表单请先保存。手机旧队列不会自动跨数据集提交。" @close="open = false">
      <template #footer><AppButton @click="open = false">返回保存</AppButton><AppButton @click="switchDataset">确认切换</AppButton></template>
    </AppModal>
  </div>
</template>
<style scoped>
.dataset-switch { padding: 12px; border-radius: 16px; background: var(--surface, #f4f8f0); }
p { color: var(--text-muted, #637567); font-size: 13px; line-height: 1.7; }
</style>
