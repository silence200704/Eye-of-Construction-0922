/** 独立审查用例：断言验收要求，失败即复现缺陷；不修改产品实现。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'

const askServer = vi.fn()
const fetchSession = vi.fn()
vi.mock('@/api/backend/runtime', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/backend/runtime')>(),
  backendActive: () => true,
}))
vi.mock('@/api/backend/assistant', () => ({
  askServer: (...args: unknown[]) => askServer(...args),
  fetchSession: (...args: unknown[]) => fetchSession(...args),
}))

import { useAssistantStore } from '@/assistant/session'
import { useBackendSessionStore } from '@/stores/backend/session'
import { mapServerAnswer } from '@/assistant/remote/answer'
import { contextPayload, createRemoteSessionState, sessionStorageKey } from '@/assistant/remote/session'
import { readRegistry } from '@/stores/demo/registry'
import type { AskContext } from '@/assistant/types'
import type { RemoteAnswer, RemoteAskReply, RemoteSession } from '@/api/backend/assistant'
import type { RestoredTurn } from '@/assistant/remote/session'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'sessionStorage', {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  }, configurable: true,
})

function answer(): RemoteAnswer {
  return {
    intent: 'point_status', status: 'answered', conclusion: '旧对象 A 的回答',
    facts: [], evidence: [], gaps: [], links: [],
    objects: { pointId: 'A', eventId: null, issueId: 'I1', workOrderId: 'W1', buildingId: 'B1' },
    sources: { facts: 'server_db', queriedAt: '2026-10-23T10:00:00+08:00' },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  sessionStorage.clear()
  askServer.mockReset()
  fetchSession.mockReset()
})

describe('阶段 7 审查：真实跨层契约与异步边界', () => {
  it('候选选择发送后端 QueryContext 接受的明确点选字段', () => {
    const payload = contextPayload({ pointId: 'A', chosen: true }, {})
    expect(payload).toEqual({ chosen: true, pointId: 'A', source: 'previous' })
  })

  it('映射回答时保留问题/工单 ID，供下一轮绑定', () => {
    expect(mapServerAnswer(answer(), '这个问题呢').context).toMatchObject({
      pointId: 'A', issueId: 'I1', workOrderId: 'W1',
    })
  })

  it('远程请求中切换页面对象后丢弃旧对象回答', async () => {
    const pendingReply = deferred<RemoteAskReply>()
    askServer.mockReturnValue(pendingReply.promise)
    const store = useAssistantStore()
    store.setPageContext({ pointId: 'A' })
    const pending = store.ask('B03-F2-CRACK01 现在怎么样')
    store.setPageContext({ pointId: 'B' })
    pendingReply.resolve({ sessionId: 'old-session', turnId: 'old-turn', answer: answer() })
    await pending
    expect(store.last?.result).toBeNull()
    expect(store.pageContext.pointId).toBe('B')
  })

  it('身份切换后迟到的响应不能把旧会话 ID 写入新身份存储', async () => {
    const pendingReply = deferred<RemoteAskReply>()
    askServer.mockReturnValue(pendingReply.promise)
    const store = useAssistantStore()
    const pending = store.ask('B03-F2-CRACK01 现在怎么样')
    useBackendSessionStore().user = {
      id: 'new-actor', name: '新身份', role: 'safety', roleLabel: '安全', buildingIds: [],
    }
    await nextTick()
    pendingReply.resolve({ sessionId: 'old-actor-session', turnId: 'old-turn', answer: answer() })
    await pending
    expect(sessionStorage.getItem(sessionStorageKey(readRegistry().resetAt, 'new-actor'))).toBeNull()
  })

  it('会话恢复请求中清空状态后，不得重新灌入旧轮次', async () => {
    const pendingReply = deferred<RemoteSession>()
    fetchSession.mockReturnValue(pendingReply.promise)
    const turns = ref<RestoredTurn[]>([])
    const remote = createRemoteSessionState({
      turns, context: ref<AskContext>({}), pageContext: ref<AskContext>({}),
      contextLabel: ref(''), notice: ref(''), endGuide: () => {},
      bumpGeneration: () => {}, turnOf: (row) => row,
    })
    sessionStorage.setItem(sessionStorageKey(readRegistry().resetAt, 'none'), 'old-session')
    const pending = remote.restore()
    remote.clear('身份已切换')
    pendingReply.resolve({
      id: 'old-session', title: '旧会话', turnCount: 1, actorId: 'old-actor',
      createdAt: '', updatedAt: '', turns: [{ id: 'old-turn', seq: 1,
        question: '旧问题', answer: answer(), createdAt: '' }],
    })
    await pending
    expect(turns.value).toEqual([])
    expect(remote.sessionId.value).toBe('')
  })
})
