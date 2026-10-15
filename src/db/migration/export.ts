import Dexie from 'dexie'
import { ZhutongDatabase } from '@/db/database'
import { blobToDataUrl } from '@/db/backup'
import { toPlain } from '@/core/plain'
import type { LegacyRow, MigrationPackage, MigrationProblem } from './types'

export function exportPreferences(sourceName: string): { key: string; value: string }[] {
  const rows = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(`${sourceName}/`)) rows.push({ key, value: localStorage.getItem(key) ?? '' })
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

async function encodeAttachments(rows: LegacyRow[], warnings: MigrationProblem[]): Promise<LegacyRow[]> {
  return Promise.all(rows.map(async row => {
    const { blob, thumb, ...meta } = row
    const invalid = !(blob instanceof Blob) || !(thumb instanceof Blob)
    if (invalid) warnings.push({ table: 'attachments', id: row.id, message: '照片或缩略图字节已损坏，保留元数据并等待处理' })
    return { ...meta, blob: blob instanceof Blob ? await blobToDataUrl(blob) : null, thumb: thumb instanceof Blob ? await blobToDataUrl(thumb) : null } as LegacyRow
  }))
}

export async function exportLegacyDatabase(sourceName: string, runtime: Record<string, unknown> = {}): Promise<MigrationPackage | null> {
  if (!await Dexie.exists(sourceName)) return null
  const source = new ZhutongDatabase(sourceName)
  try {
    await source.open()
    const data: Record<string, LegacyRow[]> = await source.transaction('r', source.tables, async () =>
      Object.fromEntries(await Promise.all(source.tables.map(async table => [table.name, await table.toArray()]))))
    const warnings: MigrationProblem[] = []
    data.attachments = await encodeAttachments(data.attachments ?? [], warnings)
    return {
      format: 'zhutong-migration-v1', schemaVersion: 7, sourceName, exportedAt: new Date().toISOString(),
      counts: Object.fromEntries(Object.entries(data).map(([key, rows]) => [key, rows.length])), data,
      runtime: { preferences: exportPreferences(sourceName), ...toPlain(runtime) }, warnings,
    }
  } finally { source.close() }
}
