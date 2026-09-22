/**
 * 确认事件的写入测试。
 *
 * 重点：事件状态与它名下所有通知的确认状态必须**一起**落库。
 * 之前是"先写事件、再逐条 put 通知"，中间失败会留下"事件已转处理中、通知还挂着未确认"的半成品，
 * 超时提醒的口径就不可解释了。
 */
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { db } from '@/db/database'
import { useEventsStore } from '@/stores/events'
import { useSessionStore } from '@/stores/session'
import type { AlarmNotification } from '@/types/events'
import { makeEvent } from '../fixtures'

const AT = '2026-09-20T09:00:00.000Z'

function notification(override: Partial<AlarmNotification> = {}): AlarmNotification {
  return {
    id: 'noti_1',
    eventId: 'evt_1',
    eventNo: 'E20260920-001',
    level: 'yellow',
    target: '学校安全管理人员',
    channel: '站内',
    createdAt: AT,
    presentedAt: null,
    acknowledgedAt: null,
    acknowledgedBy: '',
    dueMinutes: 30,
    fallback: '值班替补',
    escalatedAt: null,
    escalatedTo: '',
    escalationSource: '',
    ...override,
  }
}

describe('确认事件', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.delete()
    await db.open()
    const session = useSessionStore()
    session.name = '安全管理员'
    session.role = 'safety'
  })

  it('事件转处理中，名下未确认通知一并标记为已确认', async () => {
    await db.events.put(makeEvent({ status: 'pending' }))
    await db.notifications.bulkPut([
      notification({ id: 'noti_1' }),
      notification({ id: 'noti_2', target: '物业值班人员' }),
      notification({ id: 'noti_3', acknowledgedAt: AT, acknowledgedBy: '早先处理人' }),
    ])

    const events = useEventsStore()
    await events.load()
    await events.acknowledgeEvent('evt_1')

    const event = await db.events.get('evt_1')
    expect(event?.status).toBe('handling')
    expect(event?.acknowledgedBy).toBe('安全管理员')
    expect(event?.timeline.at(-1)?.action).toContain('确认事件')

    const notes = await db.notifications.toArray()
    expect(notes.every((row) => row.acknowledgedAt !== null)).toBe(true)
    // 已经确认过的那条不被改写
    expect(notes.find((row) => row.id === 'noti_3')?.acknowledgedBy).toBe('早先处理人')
    expect(notes.filter((row) => row.acknowledgedBy === '安全管理员')).toHaveLength(2)
  })

  it('通知写入失败时事件状态不落地（不留"已处理中但通知还没确认"）', async () => {
    await db.events.put(makeEvent({ status: 'pending' }))
    await db.notifications.put(notification({ id: 'noti_1' }))
    const events = useEventsStore()
    await events.load()

    const original = db.notifications.bulkPut.bind(db.notifications)
    ;(db.notifications as unknown as { bulkPut: unknown }).bulkPut = () => {
      throw new Error('模拟通知写入失败')
    }
    let failed = false
    try {
      await events.acknowledgeEvent('evt_1')
    } catch {
      failed = true
    } finally {
      ;(db.notifications as unknown as { bulkPut: unknown }).bulkPut = original
    }
    expect(failed).toBe(true)

    const event = await db.events.get('evt_1')
    expect(event?.status).toBe('pending')
    expect(event?.acknowledgedBy).toBe('')
    const note = await db.notifications.get('noti_1')
    expect(note?.acknowledgedAt).toBeNull()
  })

  it('已经不是待确认的事件不做任何改动', async () => {
    await db.events.put(makeEvent({ status: 'recovering' }))
    await db.notifications.put(notification({ id: 'noti_1' }))
    const events = useEventsStore()
    await events.load()

    await events.acknowledgeEvent('evt_1')

    expect((await db.events.get('evt_1'))?.status).toBe('recovering')
    expect((await db.notifications.get('noti_1'))?.acknowledgedAt).toBeNull()
  })
})
