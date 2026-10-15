import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createHttpClient, HttpError } from '@/api/http/client'
import { apiBaseUrl, type BackendUser, type LoginResult } from '@/api/http/runtime'
import { useSessionStore } from '@/stores/session'

const TOKEN_KEY = 'zhutong-api/access-token'

export const useBackendSessionStore = defineStore('backendSession', () => {
  const user = ref<BackendUser | null>(null)
  const accounts = ref<BackendUser[]>([])
  const busy = ref(false)
  const message = ref('')
  let generation = 0

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
    useSessionStore().setIdentity(next.name, next.role)
  }

  async function loadAccounts(): Promise<void> {
    try { accounts.value = await http.request<BackendUser[]>({ path: '/demo/accounts' }) }
    catch (cause) {
      accounts.value = []
      if (!(cause instanceof HttpError && cause.status === 404)) {
        message.value = cause instanceof Error ? cause.message : String(cause)
      }
    }
  }

  async function authenticate(path: string, body: unknown): Promise<boolean> {
    const current = ++generation
    busy.value = true
    message.value = ''
    try {
      const result = await http.request<LoginResult>({ path, method: 'POST', body })
      if (current !== generation) return false
      localStorage.setItem(TOKEN_KEY, result.accessToken)
      accept(result.user)
      return true
    } catch (cause) {
      message.value = cause instanceof Error ? cause.message : String(cause)
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
      message.value = cause instanceof Error ? cause.message : String(cause)
    } finally { if (current === generation) busy.value = false }
  }

  async function logout(): Promise<void> {
    try { await http.request({ path: '/auth/logout', method: 'POST' }) }
    catch (cause) { message.value = cause instanceof Error ? cause.message : String(cause) }
    finally { invalidate() }
  }

  const select = (accountId: string) => authenticate('/demo/login', { accountId })
  const login = (username: string, password: string) => authenticate('/auth/login', { username, password })
  return { user, accounts, busy, message, loadAccounts, select, login, restore, logout }
})
