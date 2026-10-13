import 'fake-indexeddb/auto'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useMaintenanceTaskStore } from '@/stores/maintenance/tasks'
import { useRecordsStore } from '@/stores/records'
import { useWorkOrderStore } from '@/stores/inspection/workOrders'

export async function freshSeed(): Promise<void> {
  setActivePinia(createPinia())
  localStorage.clear()
  await db.delete()
  await db.open()
  await useArchiveStore().loadSeed()
}

/** 场景的幂等判断依赖应用启动后读入的 store 快照。 */
export async function reloadAll(): Promise<void> {
  await useArchiveStore().reload()
  await useRecordsStore().reload()
  await useEventsStore().reload()
  await useIssueStore().reload()
  await useWorkOrderStore().reload()
  await useMaintenanceTaskStore().reload()
}
