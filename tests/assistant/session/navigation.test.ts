import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { AskLink } from '@/assistant/types'
import { navigateFromAnswer } from '@/components/assistant/presentation/navigation'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/media', '/campus', '/alarms'].map(path => ({ path, component: {} })),
  })
}

function link(path: string, query: Record<string, string>): AskLink {
  return { kind: 'media_page', label: '打开', path, query, deep: true, note: '' }
}

describe('小瞳回答跳转让出目标页面', () => {
  it.each([
    ['/media', { point: 'pnt_b03_f2_crack01' }],
    ['/campus', { view: '3d', b: 'bld_b03', f: 'flr_b03_02', point: 'pnt_b03_f2_crack01' }],
    ['/alarms', { event: 'evt_demo' }],
  ] as const)('完成 %s 定位后才收起，不丢失对象参数', async (path, query) => {
    const router = makeRouter()
    await router.push('/')
    const close = vi.fn(() => {
      expect(router.currentRoute.value.path).toBe(path)
      expect(router.currentRoute.value.query).toEqual(query)
    })
    expect(await navigateFromAnswer({ router, link: link(path, query), close })).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('目标已经打开时也收起，避免同页链接看起来无效', async () => {
    const router = makeRouter()
    const target = link('/media', { point: 'pnt_demo' })
    await router.push(target)
    const close = vi.fn()
    expect(await navigateFromAnswer({ router, link: target, close })).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('被导航守卫取消时保留回答面板', async () => {
    const router = makeRouter()
    await router.push('/')
    router.beforeEach(() => false)
    const close = vi.fn()
    expect(await navigateFromAnswer({ router, link: link('/media', {}), close })).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('导航异常时不收起，交由面板显示可重试提示', async () => {
    const close = vi.fn()
    const router = { push: vi.fn().mockRejectedValue(new Error('页面加载失败')) }
    await expect(navigateFromAnswer({ router, link: link('/media', {}), close })).rejects.toThrow('页面加载失败')
    expect(close).not.toHaveBeenCalled()
  })
})
