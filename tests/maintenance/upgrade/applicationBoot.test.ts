/** 应用真实启动顺序：旧库升级后每个仓储都能载入，不能在首屏前白屏。 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { DB_NAME, db } from '@/db/database'
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
import { startApplication } from '@/core/app/startup'
import { createNativeApplicationV4 } from './legacyDb'

async function bootFromLegacyV4(): Promise<void> {
  await startApplication({
    archive: useArchiveStore(),
    records: useRecordsStore(),
    events: useEventsStore(),
    reloaders: [
      usePlanStore(),
      useTaskStore(),
      useIssueStore(),
      useWorkOrderStore(),
      useAttachmentStore(),
      useMaintenancePlanStore(),
      useMaintenanceTaskStore(),
    ],
  })
}

afterEach(async () => {
  db.close()
  await Dexie.delete(DB_NAME)
})

describe('应用启动：物理版本 40 的旧库', () => {
  it('完整 boot 流程可完成，全部业务仓储保留旧行', async () => {
    db.close()
    await createNativeApplicationV4(DB_NAME)
    // 测试复用了模块级 db；真实刷新会新建实例并自动 open，这里显式打开等价模拟。
    await db.open()
    setActivePinia(createPinia())

    await expect(bootFromLegacyV4()).resolves.toBeUndefined()

    expect(useArchiveStore().buildings).toHaveLength(1)
    expect(useRecordsStore().records).toHaveLength(1)
    expect(useEventsStore().events).toHaveLength(1)
    expect(usePlanStore().plans).toHaveLength(1)
    expect(useIssueStore().issues).toHaveLength(1)
    expect(useTaskStore().loaded).toBe(true)
    expect(useWorkOrderStore().loaded).toBe(true)
    expect(useAttachmentStore().loaded).toBe(true)
    expect(useMaintenancePlanStore().loaded).toBe(true)
    expect(useMaintenanceTaskStore().loaded).toBe(true)
  })
})
