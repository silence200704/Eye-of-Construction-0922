import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useBackendSessionStore } from './session'
import { collectLegacyPackages, datasetFor, downloadMigration } from '@/core/migration/collect'
import { migratePackage } from '@/core/migration/runner'
import type { MigrationPackage, MigrationReport, MigrationResult } from '@/db/migration/types'

export const useLegacyMigrationStore = defineStore('legacyMigration', () => {
  const auth = useBackendSessionStore()
  const busy = ref(false)
  const message = ref('')
  const results = ref<MigrationResult[]>([])
  const canImport = computed(() => auth.user?.role === 'safety' && auth.user?.buildingIds === null)

  async function guarded(action: () => Promise<void>): Promise<void> {
    if (busy.value) return
    busy.value = true
    message.value = ''
    try { await action() }
    catch (cause) { message.value = cause instanceof Error ? cause.message : String(cause) }
    finally { busy.value = false }
  }

  async function migrate(packages: MigrationPackage[]): Promise<void> {
    if (!canImport.value) throw new Error('请先切换到学校安全管理身份')
    results.value = []
    for (const payload of packages) {
      message.value = `正在预检并导入 ${payload.sourceName}…`
      results.value.push(await migratePackage(auth.http, datasetFor(payload.sourceName), payload))
    }
    message.value = results.value.every(row => row.status === 'imported') ? '导入与字段核对完成，浏览器原数据已保留' : '部分来源未通过预检，请查看下方逐项报告'
  }

  const runLocal = () => guarded(async () => {
    const collected = await collectLegacyPackages()
    await migrate(collected.packages)
    if (collected.missing.length) message.value += `；未发现 ${collected.missing.join('、')}，未创建空库`
  })
  const exportLocal = () => guarded(async () => {
    const collected = await collectLegacyPackages()
    downloadMigration({ format: 'zhutong-migration-collection-v1', ...collected }, 'zhutong-legacy-migration.json')
    message.value = '迁移快照已导出，包含本浏览器可获取的旧库、当前临时数据和随包素材'
  })
  const importFile = (file: File) => guarded(async () => {
    if (file.size > 80 * 1024 * 1024) throw new Error('迁移文件超过 80 MiB 限制')
    const parsed = JSON.parse(await file.text())
    const packages = parsed.format === 'zhutong-migration-collection-v1' ? parsed.packages : [parsed]
    if (!Array.isArray(packages)) throw new Error('迁移文件结构无效')
    await migrate(packages)
  })
  const loadHistory = () => guarded(async () => {
    if (!canImport.value) return
    results.value = []
    for (const id of ['demo-main', 'demo-showcase']) {
      const reports = await auth.http.request<MigrationReport[]>({ path: `/datasets/${id}/imports` })
      results.value.push(...reports.map(report => ({ sourceName: report.sourceName, datasetId: id, status: 'imported' as const, report })))
    }
  })
  const exportReport = () => downloadMigration(results.value, 'zhutong-migration-report.json')
  return { busy, message, results, canImport, runLocal, exportLocal, importFile, loadHistory, exportReport }
})
