import { describe, expect, it, vi } from 'vitest'
import { createHttpClient, HttpError } from '@/api/http/client'

const success = (data: unknown) => new Response(JSON.stringify({ ok: true, data, rev: null, replayed: false }), {
  headers: { 'Content-Type': 'application/json' },
})

describe('真实 HTTP 传输', () => {
  it('附带当前令牌，调用服务端并返回数据', async () => {
    const fetcher = vi.fn().mockResolvedValue(success({ role: 'inspector' }))
    const http = createHttpClient({ fetcher, token: () => 'server-token' })
    expect(await http.request({ path: '/auth/me' })).toEqual({ role: 'inspector' })
    const [url, options] = fetcher.mock.calls[0]
    expect(url).toBe('/api/v1/auth/me')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer server-token')
  })

  it('透出服务端冲突，保留错误码和请求标识', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: 'VERSION_CONFLICT', message: '版本已变化', retryable: false, details: {} },
      meta: { requestId: 'request-1' },
    }), { status: 409 }))
    const http = createHttpClient({ fetcher })
    await expect(http.request({ path: '/issues/one', method: 'PATCH', body: {} })).rejects.toMatchObject({
      code: 'VERSION_CONFLICT', status: 409, requestId: 'request-1',
    })
  })

  it('身份失效时清理会话，不静默回到本地写入', async () => {
    const unauthorized = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: 'AUTH_REQUIRED', message: '请重新连接', retryable: false, details: {} },
    }), { status: 401 }))
    const http = createHttpClient({ fetcher, unauthorized })
    await expect(http.request({ path: '/auth/me' })).rejects.toBeInstanceOf(HttpError)
    expect(unauthorized).toHaveBeenCalledOnce()
  })

  it('网络失败可重试但不生成成功回执', async () => {
    const http = createHttpClient({ fetcher: vi.fn().mockRejectedValue(new TypeError('offline')) })
    await expect(http.request({ path: '/auth/me' })).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE', retryable: true,
    })
  })

  it('拒绝非 API 响应，避免将代理错误页当作成功', async () => {
    const http = createHttpClient({ fetcher: vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>')) })
    await expect(http.request({ path: '/health/live' })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('身份切换失败不携带旧令牌，也不清理当前身份', async () => {
    const unauthorized = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: 'AUTH_REQUIRED', message: '身份不可用', retryable: false },
    }), { status: 401 }))
    const http = createHttpClient({ fetcher, token: () => 'existing-token', unauthorized })
    await expect(http.request({ path: '/demo/identity', method: 'POST', anonymous: true, body: {} })).rejects.toBeInstanceOf(HttpError)
    expect(new Headers(fetcher.mock.calls[0][1].headers).has('Authorization')).toBe(false)
    expect(unauthorized).not.toHaveBeenCalled()
  })
})
