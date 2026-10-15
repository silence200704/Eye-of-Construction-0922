import { HttpError, type createHttpClient } from '@/api/http/client'
import type { MigrationPackage, MigrationReport, MigrationResult } from '@/db/migration/types'

export async function migratePackage(http: Pick<ReturnType<typeof createHttpClient>, 'request'>, datasetId: string, payload: MigrationPackage): Promise<MigrationResult> {
  const path = `/datasets/${encodeURIComponent(datasetId)}/imports`
  let report = await http.request<MigrationReport>({ path: `${path}/preview`, method: 'POST', body: payload, timeoutMs: 120000 })
  if (!report.valid) return { sourceName: payload.sourceName, datasetId, status: 'blocked', report }
  try { report = await http.request<MigrationReport>({ path, method: 'POST', body: payload, timeoutMs: 120000 }) }
  catch (cause) {
    if (!(cause instanceof HttpError) || !cause.details.report) throw cause
    report = cause.details.report as MigrationReport
  }
  return { sourceName: payload.sourceName, datasetId, status: report.valid ? 'imported' : 'blocked', report }
}
