/**
 * 本机界面提醒中心。
 *
 * 不把它当作短信、系统通知或后台推送：事件通知的生成与确认仍在 events store；
 * 这里仅记录当前浏览器会话已经向操作者呈现过哪些新建 / 升级事件。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { batchAlertPrompt, eventAlertPrompt, type AlertPrompt, type AlertPromptEventInput } from '@/core/event/alertPrompt'

export interface AlertInboxItem extends AlertPrompt {
  seenAt: string | null
  dismissedAt: string | null
}

function now(): string {
  return new Date().toISOString()
}

export const useAlertStore = defineStore('alerts', () => {
  const items = ref<AlertInboxItem[]>([])

  const unreadCount = computed(() => items.value.filter((row) => row.seenAt === null).length)
  const activeStrong = computed(() => items.value.find((row) => row.strong && row.dismissedAt === null) ?? null)
  const newest = computed(() => [...items.value])

  function add(prompt: AlertPrompt | null): void {
    if (prompt === null || items.value.some((row) => row.key === prompt.key)) return
    items.value.unshift({ ...prompt, seenAt: null, dismissedAt: null })
  }

  function enqueueEvent(input: AlertPromptEventInput): void {
    add(eventAlertPrompt(input))
  }

  function enqueueBatch(inputs: AlertPromptEventInput[]): void {
    add(batchAlertPrompt(inputs))
  }

  function markSeen(key: string): void {
    const item = items.value.find((row) => row.key === key)
    if (item !== undefined && item.seenAt === null) item.seenAt = now()
  }

  function dismiss(key: string): void {
    const item = items.value.find((row) => row.key === key)
    if (item === undefined) return
    if (item.seenAt === null) item.seenAt = now()
    item.dismissedAt = now()
  }

  function markAllSeen(): void {
    for (const item of items.value) {
      if (item.seenAt === null) item.seenAt = now()
    }
  }

  return { items, unreadCount, activeStrong, newest, enqueueEvent, enqueueBatch, markSeen, dismiss, markAllSeen }
})
