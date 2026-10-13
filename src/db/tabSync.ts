/**
 * 多标签页变更提醒。
 * V0.1 不做跨标签页同步（属 V2.0 的协同范围），但两个窗口同时编辑会互相覆盖，
 * 因此检测到其它标签页写入时提示刷新，避免演示中数据莫名错乱。
 */
import { uid } from '@/core/id'
import { workspaceStorageKey } from '@/core/demo/workspace'

const CHANNEL = workspaceStorageKey('zhutong-demo/tab')
const TAB_ID = uid('tab')

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  channel ??= new BroadcastChannel(CHANNEL)
  return channel
}

/** 本标签页写完数据后广播一次；自身不会收到自己的消息。 */
export function announceChange(): void {
  getChannel()?.postMessage({ tab: TAB_ID })
}

/** 订阅其它标签页的写入；返回取消订阅函数。 */
export function listenExternalChange(handler: () => void): () => void {
  const target = getChannel()
  if (target === null) return () => undefined
  const listener = (event: MessageEvent): void => {
    const data = event.data as { tab?: string } | null
    if (data !== null && data !== undefined && data.tab !== TAB_ID) handler()
  }
  target.addEventListener('message', listener)
  return () => target.removeEventListener('message', listener)
}
