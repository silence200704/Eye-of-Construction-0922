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
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import AppShell from '@/components/AppShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { startApplication } from '@/core/app/startup'
import { backendEnabled } from '@/api/http/runtime'
import BackendAccess from '@/components/session/BackendAccess.vue'

const archive = useArchiveStore()
const records = useRecordsStore()
const events = useEventsStore()
const plans = usePlanStore()
const tasks = useTaskStore()
const issues = useIssueStore()
const workOrders = useWorkOrderStore()
const attachments = useAttachmentStore()
const maintenancePlans = useMaintenancePlanStore()
const maintenanceTasks = useMaintenanceTaskStore()
const ready = ref(false)
const error = ref('')

async function boot(): Promise<void> {
  error.value = ''
  try {
    await startApplication({
      archive,
      records,
      events,
      reloaders: [plans, tasks, issues, workOrders, attachments, maintenancePlans, maintenanceTasks],
    })
    ready.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

onMounted(() => { if (!backendEnabled) void boot() })
</script>

<template>
  <BackendAccess v-if="backendEnabled" @authenticated="boot">
    <AppShell v-if="ready" />
    <div v-else class="boot">
      <EmptyState :title="error === '' ? '正在载入业务资料…' : '业务资料载入失败'" :sub="error">
        <AppButton v-if="error !== ''" variant="primary" @click="boot">重试</AppButton>
      </EmptyState>
    </div>
  </BackendAccess>
  <AppShell v-else-if="ready" />
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
