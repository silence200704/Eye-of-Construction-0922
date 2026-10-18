/** 预警事件与站内通知的服务端命令。 */
import type { AlarmEvent, AlarmNotification } from '@/types/events'
import { command, read } from './runtime'

export async function fetchEvents(status: 'all' | 'open' | 'closed' = 'all'): Promise<AlarmEvent[]> {
  return read<AlarmEvent[]>('/events', { status })
}

export async function fetchNotifications(): Promise<AlarmNotification[]> {
  return read<AlarmNotification[]>('/notifications')
}

export async function acknowledgeEventRemote(id: string, expectedRev: number | undefined): Promise<AlarmEvent> {
  const result = await command<AlarmEvent>(`/events/${id}/acknowledge`, {
    body: { expectedRev },
    key: `event_acknowledge|${id}`,
  })
  return result.data
}

export async function closeEventRemote(
  id: string, expectedRev: number | undefined, basis: string, noRepairNote: string,
): Promise<AlarmEvent> {
  const result = await command<AlarmEvent>(`/events/${id}/close`, {
    body: { expectedRev, basis, noRepairNote },
    key: `event_close|${id}`,
  })
  return result.data
}

export async function presentNotificationRemote(id: string): Promise<AlarmNotification> {
  const result = await command<AlarmNotification>(`/notifications/${id}/present`, {
    body: {},
    key: `notification_present|${id}`,
  })
  return result.data
}

export async function acknowledgeNotificationRemote(id: string): Promise<AlarmNotification> {
  const result = await command<AlarmNotification>(`/notifications/${id}/acknowledge`, {
    body: {},
    key: `notification_acknowledge|${id}`,
  })
  return result.data
}

export async function escalateDueRemote(): Promise<{ escalated: number; rows: AlarmNotification[] }> {
  const bucket = Math.floor(Date.now() / 60_000)
  const result = await command<{ escalated: number; rows: AlarmNotification[] }>('/notifications/escalate', {
    body: {},
    key: `notification_escalate|${bucket}`,
  })
  return result.data
}
