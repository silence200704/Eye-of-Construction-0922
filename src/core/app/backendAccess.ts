import { watch, type WatchStopHandle } from 'vue'

/** 身份切换由父层观察并初始化工作台，不依赖已卸载子层的迟到事件。 */
interface WorkspaceIdentity { id: string; role?: string; buildingIds?: string[] | null }
export function watchBackendIdentity(user: () => WorkspaceIdentity | null, boot: () => void): WatchStopHandle {
  return watch(() => {
    const current = user()
    return current ? JSON.stringify([current.id, current.role ?? '', current.buildingIds ? [...current.buildingIds].sort() : null]) : ''
  }, key => { if (key) boot() }, { immediate: true, flush: 'post' })
}
