/**
 * 演示身份：V0.1 用身份切换区分录入人与操作留痕。
 * 角色切换不等于真实鉴权，V2.0 由服务端账号与权限控制。
 */
import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { roleName } from '@/types/catalog'
import { workspaceStorageKey } from '@/core/demo/workspace'

const KEY = workspaceStorageKey('zhutong-demo/session')

interface StoredSession {
  name: string
  role: string
}

const DEFAULT_SESSION: StoredSession = { name: '演示操作员', role: 'safety' }

function load(): StoredSession {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        const candidate = parsed as Partial<StoredSession>
        if (typeof candidate.name === 'string' && typeof candidate.role === 'string') {
          return { name: candidate.name, role: candidate.role }
        }
      }
    }
  } catch {
    // 本地偏好损坏时回退默认身份，不影响业务数据
  }
  return { ...DEFAULT_SESSION }
}

export const useSessionStore = defineStore('session', () => {
  const stored = load()
  const name = ref(stored.name)
  const role = ref(stored.role)

  const roleLabel = computed(() => roleName(role.value))
  const actorLabel = computed(() => `${name.value} · ${roleLabel.value}`)

  watch([name, role], () => {
    localStorage.setItem(KEY, JSON.stringify({ name: name.value, role: role.value }))
  })

  function setIdentity(nextName: string, nextRole: string): void {
    name.value = nextName.trim() === '' ? DEFAULT_SESSION.name : nextName.trim()
    role.value = nextRole
  }

  return { name, role, roleLabel, actorLabel, setIdentity }
})
