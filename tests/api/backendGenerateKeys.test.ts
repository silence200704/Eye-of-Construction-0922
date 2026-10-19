import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { generate, fetchTasks } = vi.hoisted(() => ({
  generate: vi.fn(),
  fetchTasks: vi.fn(),
}))

vi.mock('@/api/backend/runtime', () => ({ backendActive: () => true }))
vi.mock('@/api/backend/field', () => ({
  fetchInspectionTasks: fetchTasks,
  generateInspectionTasksRemote: generate,
}))

import { useTaskStore } from '@/stores/inspection/tasks'

describe('inspection task generation command keys', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    generate.mockReset()
    fetchTasks.mockReset()
    fetchTasks.mockResolvedValue([])
  })

  it('creates a new key for an independent user operation', async () => {
    generate.mockResolvedValue({ created: [], skipped: 0 })
    const tasks = useTaskStore()
    const day = new Date(2026, 9, 19)
    await tasks.generateFor(day)
    const first = generate.mock.calls.at(-1)?.[1]
    await tasks.generateFor(day)
    const second = generate.mock.calls.at(-1)?.[1]
    expect(first).not.toBe(second)
  })

  it('reuses the same key when the same operation is retried after failure', async () => {
    generate.mockRejectedValueOnce(new Error('net down'))
    generate.mockResolvedValue({ created: [], skipped: 0 })
    const tasks = useTaskStore()
    const day = new Date(2026, 9, 19)
    await expect(tasks.generateFor(day)).rejects.toThrow('net down')
    const failedKey = generate.mock.calls.at(-1)?.[1]
    await tasks.generateFor(day)
    const retryKey = generate.mock.calls.at(-1)?.[1]
    expect(retryKey).toBe(failedKey)
  })
})
