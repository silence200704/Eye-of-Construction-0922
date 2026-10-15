import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { watchBackendIdentity } from '@/core/app/backendAccess'

describe('登录状态与工作台初始化', () => {
  it('从登录页切换到工作台时，初始化不依赖已移除子组件的事件', async () => {
    const user = ref<{ id: string } | null>(null)
    const boot = vi.fn()
    const scope = effectScope()
    scope.run(() => watchBackendIdentity(() => user.value, boot))
    expect(boot).not.toHaveBeenCalled()
    user.value = { id: 'demo-inspector' }
    await nextTick()
    expect(boot).toHaveBeenCalledOnce()
    user.value = { id: 'demo-inspector' }
    await nextTick()
    expect(boot).toHaveBeenCalledOnce()
    user.value = { id: 'demo-repair' }
    await nextTick()
    expect(boot).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('退出后不会重新初始化，组件卸载后停止观察', async () => {
    const user = ref<{ id: string } | null>({ id: 'demo-safety' })
    const boot = vi.fn()
    const scope = effectScope()
    scope.run(() => watchBackendIdentity(() => user.value, boot))
    expect(boot).toHaveBeenCalledOnce()
    user.value = null
    await nextTick()
    expect(boot).toHaveBeenCalledOnce()
    scope.stop()
    user.value = { id: 'demo-repair' }
    await nextTick()
    expect(boot).toHaveBeenCalledOnce()
  })
})
