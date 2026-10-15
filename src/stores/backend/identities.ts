import { ref } from 'vue'
import { createHttpClient } from '@/api/http/client'
import type { BackendUser } from '@/api/http/runtime'

export function createIdentityDirectory(http: ReturnType<typeof createHttpClient>, report: (text: string) => void) {
  const identities = ref<BackendUser[]>([])
  async function loadIdentities(): Promise<boolean> {
    try {
      identities.value = await http.request<BackendUser[]>({ path: '/demo/identities', anonymous: true })
      if (!identities.value.length) throw new Error('暂无可用演示身份，请检查服务端初始化状态')
      report('')
      return true
    } catch (cause) {
      identities.value = []
      report(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }
  return { identities, loadIdentities }
}
