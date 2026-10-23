import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const askServer = vi.fn()
const fetchSession = vi.fn()

vi.mock('@/api/backend/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/backend/runtime')>()
  return { ...actual, backendActive: () => true }
})

vi.mock('@/api/backend/assistant', () => ({
  askServer: (...args: unknown[]) => askServer(...args),
  fetchSession: (...args: unknown[]) => fetchSession(...args),
}))

import { useAssistantStore } from '@/assistant/session'
import { readRegistry } from '@/stores/demo/registry'
import type { RemoteAnswer, RemoteAskReply, RemoteSession } from '@/api/backend/assistant'

const browserSession = new Map<string, string>()
if (typeof globalThis.sessionStorage === 'undefined') {
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: (key: string) => browserSession.get(key) ?? null,
      setItem: (key: string, value: string) => void browserSession.set(key, String(value)),
      removeItem: (key: string) => void browserSession.delete(key),
      clear: () => browserSession.clear(),
      key: (index: number) => [...browserSession.keys()][index] ?? null,
      get length() {
        return browserSession.size
      },
    },
    configurable: true,
  })
}

function answer(overrides: Partial<RemoteAnswer> = {}): RemoteAnswer {
  return {
    intent: 'point_status',
    status: 'answered',
    conclusion: '当前读数 0.42 mm。',
    facts: [{ label: '当前读数', value: '0.42', unit: 'mm' }],
    evidence: [],
    gaps: [],
    links: [{ kind: 'point_trend', objectId: 'pnt_1' }],
    sources: { facts: 'server_db', queriedAt: '2026-10-23T10:00:00+08:00' },
    objects: { pointId: 'pnt_1', eventId: null, issueId: null, workOrderId: null, buildingId: 'bld_1' },
    ...overrides,
  }
}

function reply(overrides: Partial<RemoteAskReply> = {}): RemoteAskReply {
  return { sessionId: 'sess_1', turnId: 'turn_1', answer: answer(), ...overrides }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  askServer.mockReset()
  fetchSession.mockReset()
})

describe('服务端模式下的小瞳会话', () => {
  it('业务问题读服务端回答并记住会话 ID', async () => {
    askServer.mockResolvedValue(reply())
    const store = useAssistantStore()
    await store.ask('B03-F2-CRACK01 现在怎么样')
    expect(askServer).toHaveBeenCalledTimes(1)
    expect(store.last?.result?.intent).toBe('point_status')
    expect(store.last?.result?.pointId).toBe('pnt_1')
    expect(store.last?.result?.sources?.facts).toBe('server_db')
    expect(store.context).toEqual({ pointId: 'pnt_1' })
    const stored = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
      .map((key) => (key === null ? '' : sessionStorage.getItem(key)))
    expect(stored).toContain('sess_1')
  })

  it('迟到响应不覆盖已切换的轮次', async () => {
    let resolveAsk: ((value: RemoteAskReply) => void) | null = null
    askServer.mockReturnValue(new Promise<RemoteAskReply>((resolve) => { resolveAsk = resolve }))
    const store = useAssistantStore()
    const pending = store.ask('B03-F2-CRACK01 现在怎么样')
    store.clearContext()
    resolveAsk?.(reply())
    await pending
    expect(store.last?.result).toBeNull()
    expect(store.last?.error).toContain('已取消')
  })

  it('后端断开时明确失败，不补造回答', async () => {
    askServer.mockRejectedValue(new Error('Failed to fetch'))
    const store = useAssistantStore()
    await store.ask('B03-F2-CRACK01 现在怎么样')
    expect(store.last?.result).toBeNull()
    expect(store.last?.error).toContain('无法读取服务端小瞳回答')
  })

  it('刷新后只读恢复上次会话，不重放媒体或写入', async () => {
    const detail: RemoteSession = {
      id: 'sess_restored',
      title: '上次会话',
      turnCount: 1,
      createdAt: '2026-10-23T09:00:00+08:00',
      updatedAt: '2026-10-23T09:00:00+08:00',
      actorId: 'demo-safety',
      turns: [
        {
          id: 'turn_old',
          seq: 1,
          question: 'B03-F2-CRACK01 现在怎么样',
          answer: answer(),
          createdAt: '2026-10-23T09:00:00+08:00',
        },
      ],
    }
    fetchSession.mockResolvedValue(detail)
    sessionStorage.setItem(
      `zhutong.assistant.session.none.${readRegistry().resetAt}`,
      'sess_restored',
    )
    const store = useAssistantStore()
    store.toggle()
    await vi.waitFor(() => expect(store.turns.length).toBe(1))
    expect(store.last?.question).toBe('B03-F2-CRACK01 现在怎么样')
    expect(store.last?.result?.pointId).toBe('pnt_1')
    expect(store.last?.presented).toBe(true)
    expect(askServer).not.toHaveBeenCalled()
  })
})
