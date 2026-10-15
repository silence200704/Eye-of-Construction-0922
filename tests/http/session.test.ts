import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendSessionStore } from '@/stores/backend/session'
import { useSessionStore } from '@/stores/session'

const reply = (data: unknown) => new Response(JSON.stringify({ ok: true, data }))
const user = (role: string) => ({ id: `demo-${role}`, name: `服务端${role}`, role, roleLabel: role, buildingIds: null })

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('服务端演示身份', () => {
  it('首次打开自动选择默认身份，无需登录', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply([user('inspector'), user('safety')]))
      .mockResolvedValueOnce(reply({ accessToken: 'default-token', user: user('safety') }))
    const auth = useBackendSessionStore()
    await auth.initialize()
    expect(auth.user?.role).toBe('safety')
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/v1/demo/identity')
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ identityId: 'demo-safety' })
  })

  it('会话过期后重新核验并恢复上次选择的身份', async () => {
    localStorage.setItem('zhutong-api/access-token', 'expired-token')
    localStorage.setItem('zhutong-api/identity-id', 'demo-repair')
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: { code: 'AUTH_REQUIRED', message: '身份已失效' } }), { status: 401 }))
      .mockResolvedValueOnce(reply([user('safety'), user('repair')]))
      .mockResolvedValueOnce(reply({ accessToken: 'renewed-token', user: user('repair') }))
    const auth = useBackendSessionStore()
    await auth.initialize()
    expect(auth.user?.role).toBe('repair')
    expect(localStorage.getItem('zhutong-api/access-token')).toBe('renewed-token')
  })

  it('服务不可用时保留原身份线索，等待手动重试', async () => {
    localStorage.setItem('zhutong-api/access-token', 'saved-token')
    localStorage.setItem('zhutong-api/identity-id', 'demo-repair')
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    const auth = useBackendSessionStore()
    await auth.initialize()
    expect(auth.user).toBeNull()
    expect(auth.message).toBeTruthy()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('zhutong-api/access-token')).toBe('saved-token')
  })

  it('伪造的上次身份必须被服务端名单过滤', async () => {
    localStorage.setItem('zhutong-api/identity-id', 'invented-admin')
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply([user('safety')]))
      .mockResolvedValueOnce(reply({ accessToken: 'safe-token', user: user('safety') }))
    const auth = useBackendSessionStore()
    await auth.initialize()
    expect(auth.user?.id).toBe('demo-safety')
  })

  it('自动初始化期间的迟到名单不能覆盖手动选择的身份', async () => {
    let finishDirectory: (value: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise(resolve => { finishDirectory = resolve }))
      .mockResolvedValueOnce(reply({ accessToken: 'manual-token', user: user('repair') }))
    const auth = useBackendSessionStore()
    const initialization = auth.initialize()
    await Promise.resolve()
    await auth.select('demo-repair')
    finishDirectory(reply([user('safety'), user('repair')]))
    await initialization
    expect(auth.user?.role).toBe('repair')
    expect(localStorage.getItem('zhutong-api/access-token')).toBe('manual-token')
  })

  it('并发初始化共用一次连接，不重复签发会话', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(reply([user('safety')]))
      .mockResolvedValueOnce(reply({ accessToken: 'default-token', user: user('safety') }))
    const auth = useBackendSessionStore()
    await Promise.all([auth.initialize(), auth.initialize()])
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(auth.user?.role).toBe('safety')
  })

  it('切换时使用服务端返回的身份与令牌', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ accessToken: 'signed-token', user: user('inspector') }))
    const auth = useBackendSessionStore()
    await auth.select('demo-inspector')
    expect(auth.user?.role).toBe('inspector')
    expect(useSessionStore().name).toBe('服务端inspector')
    expect(localStorage.getItem('zhutong-api/access-token')).toBe('signed-token')
  })

  it('刷新时用后端核验，不相信浏览器保存的姓名或角色', async () => {
    localStorage.setItem('zhutong-api/access-token', 'saved-token')
    localStorage.setItem('zhutong-demo/session', JSON.stringify({ name: '伪造管理员', role: 'safety' }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(user('repair')))
    const auth = useBackendSessionStore()
    await auth.restore()
    expect(auth.user?.role).toBe('repair')
    expect(useSessionStore().name).toBe('服务端repair')
  })

  it('失效会话清除无效令牌', async () => {
    localStorage.setItem('zhutong-api/access-token', 'expired-token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: 'AUTH_REQUIRED', message: '身份已失效', retryable: false },
    }), { status: 401 }))
    const auth = useBackendSessionStore()
    await auth.restore()
    expect(auth.user).toBeNull()
    expect(localStorage.getItem('zhutong-api/access-token')).toBeNull()
  })

  it('切换身份期间，迟到的旧响应不能覆盖新身份', async () => {
    let finishOld: (value: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce(reply({ accessToken: 'new-token', user: user('repair') }))
    const auth = useBackendSessionStore()
    const old = auth.select('demo-inspector')
    await auth.select('demo-repair')
    finishOld(reply({ accessToken: 'old-token', user: user('inspector') }))
    await old
    expect(auth.user?.role).toBe('repair')
    expect(localStorage.getItem('zhutong-api/access-token')).toBe('new-token')
  })
})
