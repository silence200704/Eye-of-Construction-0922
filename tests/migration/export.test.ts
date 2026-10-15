import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ZhutongDatabase } from '@/db/database'
import { seedDataset } from '@/db/seed'
import { exportLegacyDatabase, exportPreferences } from '@/db/migration/export'

const name = 'migration-export-test'
afterEach(async () => { await Dexie.delete(name); localStorage.clear() })

describe('旧库完整导出', () => {
  it('按一致快照导出全部表，保留原编号、时间和零修订次数', async () => {
    const source = new ZhutongDatabase(name)
    const original = seedDataset()
    await source.open()
    for (const [table, rows] of Object.entries(original)) await source.table(table).bulkPut(rows)
    source.close()
    const result = await exportLegacyDatabase(name)
    expect(result?.counts.records).toBe(original.records.length)
    expect(result?.data.records).toEqual(original.records)
    expect(result?.data.buildings).toEqual([...original.buildings].sort((a, b) => a.id.localeCompare(b.id)))
    expect(Object.keys(result?.data ?? {})).toHaveLength(17)
  })

  it('不存在的旧库不会被创建成空库或冒充已导出', async () => {
    expect(await exportLegacyDatabase(name)).toBeNull()
    expect(await Dexie.exists(name)).toBe(false)
  })

  it('损坏附件保留元数据并显式报告，不静默跳过', async () => {
    const source = new ZhutongDatabase(name)
    await source.open()
    await source.attachments.put({ id: 'broken-photo', blob: {}, thumb: {} } as never)
    source.close()
    const result = await exportLegacyDatabase(name)
    expect(result?.data.attachments).toHaveLength(1)
    expect(result?.warnings.some(row => row.id === 'broken-photo')).toBe(true)
  })

  it('只导出本工作区偏好，不导出内部令牌', () => {
    localStorage.setItem('zhutong-demo/session', '{"name":"旧人员"}')
    localStorage.setItem('zhutong-showcase/session', '{"name":"其他人员"}')
    localStorage.setItem('zhutong-api/access-token', 'private-token')
    expect(exportPreferences('zhutong-demo')).toEqual([{ key: 'zhutong-demo/session', value: '{"name":"旧人员"}' }])
  })
})
