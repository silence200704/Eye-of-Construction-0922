import { describe, expect, it } from 'vitest'
import { createHttpClient } from '@/api/http/client'
describe('live reads cannot publish a previous identity', () => {
  it('rejects JSON returned after the session token changes', async () => {
    let token = 'old'
    const client = createHttpClient({ token: () => token, fetcher: async () => {
      token = 'new'
      return new Response(JSON.stringify({ ok: true, data: ['private'] }), { status: 200 })
    } })
    await expect(client.request({ path: '/issues' })).rejects.toMatchObject({ code: 'STALE_IDENTITY' })
  })
  it('rejects protected bytes returned to a different identity', async () => {
    let token = 'old'
    const client = createHttpClient({ token: () => token, fetcher: async () => {
      token = 'new'; return new Response('photo', { status: 200 })
    } })
    await expect(client.blob('/media/x/content')).rejects.toMatchObject({ code: 'STALE_IDENTITY' })
  })
})
