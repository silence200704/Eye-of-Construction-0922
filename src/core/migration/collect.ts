import { exportLegacyDatabase } from '@/db/migration/export'
import { captureRuntime } from '@/db/migration/runtime'
import { exportBundledAssets } from '@/db/migration/assets'
import { workspaceStorageKey } from '@/core/demo/workspace'
import type { MigrationPackage } from '@/db/migration/types'

export async function collectLegacyPackages(): Promise<{ packages: MigrationPackage[]; missing: string[] }> {
  const packages: MigrationPackage[] = []
  const missing: string[] = []
  const runtime = await captureRuntime()
  for (const name of ['zhutong-demo', 'zhutong-showcase']) {
    const payload = await exportLegacyDatabase(name, name === workspaceStorageKey('zhutong-demo') ? runtime : {})
    if (payload) packages.push(payload)
    else missing.push(name)
  }
  packages.push(await exportBundledAssets())
  return { packages, missing }
}

export function downloadMigration(value: unknown, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function datasetFor(sourceName: string): string {
  return sourceName === 'zhutong-showcase' ? 'demo-showcase' : 'demo-main'
}
