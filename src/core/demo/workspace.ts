import { ref } from 'vue'
/** 在数据库实例构造前确定工作区；旧主库及其偏好键保持兼容。 */
export type Workspace = 'main' | 'showcase'
export const SHOWCASE_DB_NAME = 'zhutong-showcase'

export function resolveWorkspace(search: string): Workspace {
  return new URLSearchParams(search).get('workspace') === 'showcase' ? 'showcase' : 'main'
}

export const workspace = resolveWorkspace(typeof location === 'undefined' ? '' : location.search)
export const isShowcase = workspace === 'showcase'

export function workspaceStorageKey(key: string, mode: Workspace = workspace): string {
  return mode === 'showcase' ? key.replace(/^zhutong-demo/, SHOWCASE_DB_NAME) : key
}

export function switchWorkspace(mode: Workspace, start = false): void {
  const url = new URL(location.href)
  if (mode === 'showcase') url.searchParams.set('workspace', 'showcase')
  else url.searchParams.delete('workspace')
  if (start) url.searchParams.set('startDemo', '1')
  else url.searchParams.delete('startDemo')
  url.hash = '#/settings'
  location.assign(url.href)
}
export const demoActivity = ref(false)
