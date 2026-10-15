import { ref } from 'vue'
import { createHttpClient, HttpError } from '@/api/http/client'
import type { BackendUser } from '@/api/http/runtime'

export function createAccountDirectory(http: ReturnType<typeof createHttpClient>, report: (text: string) => void) {
  const accounts = ref<BackendUser[]>([])
  async function loadAccounts(): Promise<void> {
    try { accounts.value = await http.request<BackendUser[]>({ path: '/demo/accounts', anonymous: true }) }
    catch (cause) {
      accounts.value = []
      if (!(cause instanceof HttpError && cause.status === 404)) {
        report(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }
  return { accounts, loadAccounts }
}
