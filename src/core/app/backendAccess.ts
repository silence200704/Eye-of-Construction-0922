import { watch, type WatchStopHandle } from 'vue'

/** 身份切换由父层观察并初始化工作台，不依赖已卸载子层的迟到事件。 */
export function watchBackendIdentity(user: () => { id: string } | null, boot: () => void): WatchStopHandle {
  return watch(() => user()?.id, id => { if (id) boot() }, { immediate: true, flush: 'post' })
}
