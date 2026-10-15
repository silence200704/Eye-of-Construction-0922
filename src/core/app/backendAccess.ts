import { watch, type WatchStopHandle } from 'vue'

/** 登录页会随登录态变化卸载，初始化由父层状态观察触发，不依赖子层迟到事件。 */
export function watchBackendIdentity(user: () => { id: string } | null, boot: () => void): WatchStopHandle {
  return watch(() => user()?.id, id => { if (id) boot() }, { immediate: true, flush: 'post' })
}
