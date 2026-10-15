import { describe, expect, it, vi } from 'vitest'
import { migratePackage } from '@/core/migration/runner'
import type { MigrationPackage } from '@/db/migration/types'

const payload = { format: 'zhutong-migration-v1', sourceName: 'zhutong-demo' } as MigrationPackage

describe('迁移预检门禁', () => {
  it('预检失败不能提交，保留逐项问题', async () => {
    const request = vi.fn().mockResolvedValue({ valid: false, errors: [{ table: 'points', id: 'broken', message: '断链' }] })
    const result = await migratePackage({ request }, 'demo-main', payload)
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('blocked')
    expect(result.report.errors[0]?.id).toBe('broken')
  })

  it('预检通过后提交同一快照，不重读变动中的旧库', async () => {
    const request = vi.fn().mockResolvedValueOnce({ valid: true, errors: [] }).mockResolvedValueOnce({ valid: true, errors: [], sourceHash: 'verified' })
    const result = await migratePackage({ request }, 'demo-showcase', payload)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[1]?.[0].body).toBe(payload)
    expect(result.status).toBe('imported')
  })
})
