import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
const fetchSession = vi.hoisted(() => vi.fn())
vi.mock('@/api/backend/runtime', async (original) => ({
  ...await original<typeof import('@/api/backend/runtime')>(), backendActive: () => true,
}))
vi.mock('@/api/backend/assistant', () => ({ fetchSession }))
import { useAssistantStore } from '@/assistant/session'
import { useBackendSessionStore } from '@/stores/backend/session'
import { sessionStorageKey } from '@/assistant/remote/session'
import { readRegistry } from '@/stores/demo/registry'
import type { RemoteSession } from '@/api/backend/assistant'

const cache = new Map<string, string>()
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
  getItem: (key: string) => cache.get(key) ?? null,
  setItem: (key: string, value: string) => cache.set(key, value),
  removeItem: (key: string) => cache.delete(key), clear: () => cache.clear(),
} })
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  cache.clear()
  fetchSession.mockReset()
})

function oldSession(): RemoteSession {
  return { id: 'as-old', title: '旧会话', actorId: 'old', turnCount: 1, createdAt: '', updatedAt: '',
    turns: [{ id: 'at-old', seq: 1, question: '旧身份的问题', createdAt: '', answer: {
      intent: 'point_status', status: 'answered', conclusion: '旧身份受保护业务正文',
      facts: [], evidence: [], gaps: [], links: [],
      objects: { pointId: 'private', eventId: null, issueId: null, workOrderId: null, buildingId: 'B1' },
      sources: { facts: 'server_db', queriedAt: '' },
    } }] }
}

it('首次恢复尚未完成时换身份，也应丢弃旧身份轮次', async () => {
  const identity = useBackendSessionStore()
  identity.user = { id: 'old', name: '旧', role: 'safety', roleLabel: '安全', buildingIds: null }
  sessionStorage.setItem(sessionStorageKey(readRegistry().resetAt, 'old'), 'as-old')
  let finish!: (value: RemoteSession) => void
  fetchSession.mockReturnValue(new Promise<RemoteSession>((resolve) => { finish = resolve }))
  const store = useAssistantStore()
  store.toggle()
  await vi.waitFor(() => expect(fetchSession).toHaveBeenCalled())
  identity.user = { id: 'new', name: '新', role: 'inspector', roleLabel: '巡检', buildingIds: [] }
  await nextTick()
  finish(oldSession())
  await vi.waitFor(() => expect(store.notice).not.toBe(''))
  expect(store.turns).toEqual([])
})
