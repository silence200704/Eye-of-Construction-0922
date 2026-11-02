import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useBackendSessionStore } from '@/stores/backend/session'
import { useIssueStore } from '@/stores/inspection/issues'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'
import { useTaskStore } from '@/stores/inspection/tasks'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useAttachmentStore } from '@/stores/inspection/attachments'
import { useEventsStore } from '@/stores/events'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { usePlanStore } from '@/stores/inspection/plans'
import { useMaintenancePlanStore } from '@/stores/maintenance/plans'
import { useAlertStore } from '@/stores/alerts'
import type { InspectionIssue, InspectionTask, WorkOrder, IssueAttachment } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'
import type { AlarmEvent, AlarmNotification } from '@/types/events'
import type { BackendUser } from '@/api/http/runtime'
import { fetchAttachments, fetchAttachmentBlob } from '@/api/backend/media'
import { currentEpoch, DATASET_ID } from '@/api/backend/runtime'

function fingerprint(user: BackendUser | null): string { return JSON.stringify(user) }
function newer<T extends { id: string; rev?: number }>(remote: T[], current: T[]): T[] {
  return remote.map(row => current.find(old => old.id === row.id && (old.rev ?? 0) > (row.rev ?? 0)) ?? row)
}
export function useBusinessRefresh() {
  const session = useBackendSessionStore(), route = useRoute()
  const issues = useIssueStore(), orders = useWorkOrderStore(), tasks = useTaskStore()
  const maintenance = useMaintenanceTaskStore(), attachments = useAttachmentStore(), events = useEventsStore()
  const archive = useArchiveStore(), records = useRecordsStore(), plans = usePlanStore(), maintenancePlans = useMaintenancePlanStore(), alerts = useAlertStore()
  const message = ref(''), updatedAt = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, busy = false, delay = 5000
  let generation = 0
  function clear(): void { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  function clearProtected(): void {
    issues.issues = []; orders.orders = []; tasks.tasks = []; maintenance.tasks = []
    attachments.attachments = []; events.events = []; events.notifications = []
    archive.buildings = []; archive.floors = []; archive.points = []; archive.devices = []
    archive.baselines = []; archive.rules = []; archive.audits = []; archive.loaded = false
    records.records = []; plans.plans = []; maintenancePlans.plans = []; alerts.items = []
  }
  async function readRows<T>(path: string, epoch: number): Promise<T[]> {
    const response = await session.http.command<T[]>({ path: `/datasets/${DATASET_ID}${path}` })
    if (response.datasetEpoch !== epoch || !Array.isArray(response.data)) throw new Error('数据版本已变化，请重新读取')
    return response.data
  }
  async function refresh(): Promise<void> {
    clear()
    if (stopped || busy || document.hidden || !session.user || session.busy) return
    busy = true
    const run = generation, identity = fingerprint(session.user), epoch = currentEpoch()
    try {
      const principal = await session.http.request<BackendUser>({ path: '/auth/me' })
      if (run !== generation || identity !== fingerprint(session.user)) return
      if (identity !== fingerprint(principal)) {
        clearProtected(); await session.restore(); throw new Error('授权已更新，正在重新读取')
      }
      const [nextIssues, nextOrders, nextTasks, nextMaintenance, nextEvents, nextNotes, media] = await Promise.all([
        readRows<InspectionIssue>('/issues', epoch), readRows<WorkOrder>('/work-orders', epoch),
        readRows<InspectionTask>('/inspection/tasks', epoch), readRows<MaintenanceTask>('/maintenance/tasks', epoch),
        readRows<AlarmEvent>('/events?status=all', epoch), readRows<AlarmNotification>('/notifications', epoch), fetchAttachments(),
      ])
      const photos: IssueAttachment[] = await Promise.all(media.map(async row => {
        const existing = attachments.byId(row.id)
        const blob = existing?.blob ?? await fetchAttachmentBlob(row.contentUrl)
        return { ...row, blob, thumb: blob }
      }))
      const confirmed = await session.http.request<BackendUser>({ path: '/auth/me' })
      if (run !== generation || identity !== fingerprint(session.user) || currentEpoch() !== epoch) return
      if (identity !== fingerprint(confirmed)) { clearProtected(); await session.restore(); throw new Error('身份授权已更新') }
      issues.issues = newer(nextIssues, issues.issues); orders.orders = newer(nextOrders, orders.orders)
      tasks.tasks = newer(nextTasks, tasks.tasks); maintenance.tasks = newer(nextMaintenance, maintenance.tasks)
      events.events = newer(nextEvents, events.events); events.notifications = nextNotes; attachments.attachments = photos
      delay = 5000; message.value = ''; updatedAt.value = new Date().toLocaleTimeString('zh-CN')
    } catch (cause) {
      if (run === generation) { message.value = `同步暂缓：${cause instanceof Error ? cause.message : '连接失败'}，填写内容已保留`; delay = Math.min(30000, delay * 2) }
    } finally {
      busy = false
      if (!stopped && !document.hidden && session.user) timer = setTimeout(() => { void refresh() }, run === generation ? delay : 0)
    }
  }
  function resume(): void { generation++; clear(); if (!document.hidden) void refresh() }
  watch(() => [fingerprint(session.user), route.path], resume)
  watch(() => fingerprint(session.user), (next, previous) => { if (next !== previous) clearProtected() }, { flush: 'sync' })
  onMounted(() => { document.addEventListener('visibilitychange', resume); window.addEventListener('focus', resume); void refresh() })
  onUnmounted(() => { stopped = true; generation++; clear(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('focus', resume) })
  return { message, updatedAt, refresh }
}
