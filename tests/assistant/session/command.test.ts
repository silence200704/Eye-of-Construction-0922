import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { askZhutong } from '@/assistant/ask'
import { executeConfirmedCommand } from '@/assistant/commands/execute'
import { db } from '@/db/database'
import { useArchiveStore } from '@/stores/archive'
import { useAlertStore } from '@/stores/alerts'
import { useEventsStore } from '@/stores/events'
import { useRecordsStore } from '@/stores/records'

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.clear()
  await db.delete()
  await db.open()
  await useArchiveStore().loadSeed()
  await useRecordsStore().reload()
  await useEventsStore().reload()
})

describe('问筑瞳受确认的演示指令', () => {
  it('只提问不写库；明确的请求只给系统设置入口', async () => {
    const before = [await db.records.count(), await db.events.count(), await db.audits.count()]
    const request = await askZhutong('准备一次红色预警演示')
    expect(request.status).toBe('answered')
    expect(request.links.map((row) => row.path)).toEqual(['/settings'])
    expect(request.pendingCommands).toEqual([])
    expect([await db.records.count(), await db.events.count(), await db.audits.count()]).toEqual(before)

    for (const text of ['怎么准备红色预警演示', '不要准备红色预警演示', '准备B01-F1-CHECK01红色预警演示', '生成其它演示数据']) {
      const other = await askZhutong(text)
      expect(other.pendingCommands.every((row) => !row.enabled)).toBe(true)
    }
  })

  it('取消与未登记指令都不触碰数据库', async () => {
    const before = [await db.records.count(), await db.events.count(), await db.audits.count()]
    expect(await executeConfirmedCommand('prepare_red_demo', false)).toBeNull()
    await expect(executeConfirmedCommand('delete_database', true)).rejects.toThrow('未登记')
    expect([await db.records.count(), await db.events.count(), await db.audits.count()]).toEqual(before)
  })

  it('确认后复用现场处置场景；重复确认幂等且重现红色提醒', async () => {
    const first = await executeConfirmedCommand('prepare_red_demo', true)
    expect(first?.ok).toBe(true)
    expect(first?.created).toBe(4)
    const eventId = first?.focus?.query.event ?? ''
    expect(useEventsStore().byId(eventId)?.level).toBe('red')
    expect(useEventsStore().byId(eventId)?.status).toBe('pending')
    expect(await db.issues.count()).toBe(0)
    expect(await db.workOrders.count()).toBe(0)
    const alert = useAlertStore().activeStrong
    expect(alert?.level).toBe('red')
    useAlertStore().dismiss(alert?.key ?? '')

    const second = await executeConfirmedCommand('prepare_red_demo', true)
    expect(second?.ok).toBe(true)
    expect(second?.created).toBe(0)
    expect(second?.focus?.query.event).toBe(eventId)
    expect(useAlertStore().activeStrong?.level).toBe('red')
  })

  it('同一刻两次确认在场景队列里串行，记录与事件只生成一份', async () => {
    const before = await db.records.where('pointId').equals('pnt_b03_f2_crack01').count()
    const [first, second] = await Promise.all([
      executeConfirmedCommand('prepare_red_demo', true),
      executeConfirmedCommand('prepare_red_demo', true),
    ])
    expect([first?.created, second?.created]).toEqual([4, 0])
    expect(await db.records.where('pointId').equals('pnt_b03_f2_crack01').count()).toBe(before + 4)
    expect(await db.events.count()).toBe(1)
  })
})
