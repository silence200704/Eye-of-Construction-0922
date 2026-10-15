import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createHttpClient } from '@/api/http/client'
import { apiBaseUrl, type BackendUser, type IdentityResult } from '@/api/http/runtime'
import { useSessionStore } from '@/stores/session'
import { createIdentityDirectory } from './identities'

const TOKEN_KEY = 'zhutong-api/access-token'
const IDENTITY_KEY = 'zhutong-api/identity-id'

export const useBackendSessionStore = defineStore('backendSession', () => {
  const user = ref<BackendUser | null>(null)
  const busy = ref(false)
  const message = ref('')
  let generation = 0
  let initializing: Promise<void> | null = null

  function invalidate(): void {
    generation += 1
    user.value = null
    busy.value = false
    localStorage.removeItem(TOKEN_KEY)
  }

  const http = createHttpClient({
    baseUrl: apiBaseUrl,
    token: () => localStorage.getItem(TOKEN_KEY),
    unauthorized: invalidate,
  })

  function accept(next: BackendUser): void {
    user.value = next
    localStorage.setItem(IDENTITY_KEY, next.id)
    useSessionStore().setIdentity(next.name, next.role)
  }

  const { identities, loadIdentities } = createIdentityDirectory(http, text => { message.value = text })

  async function select(identityId: string): Promise<boolean> {
    const current = ++generation
    busy.value = true
    message.value = ''
    try {
      const result = await http.request<IdentityResult>({
        path: '/demo/identity', method: 'POST', body: { identityId }, anonymous: true,
      })
      if (current !== generation) return false
      localStorage.setItem(TOKEN_KEY, result.accessToken)
      accept(result.user)
      return true
    } catch (cause) {
      if (current === generation) message.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally { if (current === generation) busy.value = false }
  }

  async function restore(): Promise<void> {
    if (!localStorage.getItem(TOKEN_KEY)) return
    const current = ++generation
    busy.value = true
    try {
      const next = await http.request<BackendUser>({ path: '/auth/me' })
      if (current === generation) accept(next)
    } catch (cause) {
      if (current === generation) message.value = cause instanceof Error ? cause.message : String(cause)
    } finally { if (current === generation) busy.value = false }
  }

  async function initializeOnce(): Promise<void> {
    if (busy.value || user.value) return
    message.value = ''
    await restore()
    if (user.value || localStorage.getItem(TOKEN_KEY)) return
    const current = generation
    if (!await loadIdentities() || current !== generation) return
    const lastId = localStorage.getItem(IDENTITY_KEY)
    const next = identities.value.find(item => item.id === lastId)
      ?? identities.value.find(item => item.role === 'safety') ?? identities.value[0]
    if (next) await select(next.id)
  }
  function initialize(): Promise<void> {
    return initializing ??= initializeOnce().finally(() => { initializing = null })
  }

  return { http, user, identities, busy, message, loadIdentities, select, restore, initialize }
})
