<script setup lang="ts">
/** 启动时从本地数据库载入数据；首次打开按数据模式载入示例校区。 */
import { onMounted, ref } from 'vue'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { useEventsStore } from '@/stores/events'
import { usePlanStore } from '@/stores/inspection/plans'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import AppShell from '@/components/AppShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'

const archive = useArchiveStore()
const records = useRecordsStore()
const events = useEventsStore()
const plans = usePlanStore()
const tasks = useTaskStore()
const issues = useIssueStore()
const workOrders = useWorkOrderStore()
const attachments = useAttachmentStore()
const ready = ref(false)
const error = ref('')

async function boot(): Promise<void> {
  error.value = ''
  try {
    await archive.bootstrap()
    await records.load()
    await events.load()
    // 浏览器关闭期间不执行后台任务，重新打开时补查超时升级
    await events.catchUpEscalations()
    await Promise.all([
      plans.reload(),
      tasks.reload(),
      issues.reload(),
      workOrders.reload(),
      attachments.reload(),
    ])
    ready.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

onMounted(boot)
</script>

<template>
  <AppShell v-if="ready" />
  <div v-else class="boot">
    <EmptyState
      :title="error === '' ? '正在载入本地数据…' : '本地数据库打开失败'"
      :sub="error === '' ? '首次打开会载入示例校区，之后按上次状态恢复' : error"
    >
      <AppButton v-if="error !== ''" variant="primary" @click="boot">重试</AppButton>
    </EmptyState>
  </div>
</template>

<style scoped>
.boot {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 24px;
}
</style>
