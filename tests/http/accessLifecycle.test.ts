import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { watchBackendIdentity } from '@/core/app/backendAccess'

describe('身份状态与工作台初始化', () => {
  it('同一身份的角色或楼栋范围变化也会重新加载，纯对象替换不重载', async () => {
    const user = ref({ id: 'same', role: 'safety', buildingIds: null as string[] | null })
    const boot = vi.fn(), scope = effectScope()
    scope.run(() => watchBackendIdentity(() => user.value, boot))
    expect(boot).toHaveBeenCalledOnce()
    user.value = { id: 'same', role: 'device', buildingIds: ['B1'] }; await nextTick()
    expect(boot).toHaveBeenCalledTimes(2)
    user.value = { ...user.value, buildingIds: [] }; await nextTick()
    expect(boot).toHaveBeenCalledTimes(3)
    scope.stop()
  })
  it('进入工作台时，初始化不依赖已移除子组件的事件', async () => {
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
