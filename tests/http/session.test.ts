import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBackendSessionStore } from '@/stores/backend/session'
import { useSessionStore } from '@/stores/session'

const reply = (data: unknown) => new Response(JSON.stringify({ ok: true, data }))
const user = (role: string) => ({ id: `demo-${role}`, username: `demo-${role}`, name: `服务端${role}`, role, roleLabel: role, buildingIds: null })

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('服务端账号会话', () => {
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

  it('过期令牌不保留登录态', async () => {
    localStorage.setItem('zhutong-api/access-token', 'expired-token')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: 'AUTH_REQUIRED', message: '请登录', retryable: false },
    }), { status: 401 }))
    const auth = useBackendSessionStore()
    await auth.restore()
    expect(auth.user).toBeNull()
    expect(localStorage.getItem('zhutong-api/access-token')).toBeNull()
  })

  it('切换账号期间，迟到的旧响应不能覆盖新身份', async () => {
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
