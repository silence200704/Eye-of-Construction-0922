export interface MigrationProblem { table: string; id: string; message: string }
export type LegacyRow = Record<string, unknown> & { id: string }
export const MIGRATION_TABLES = ['buildings', 'floors', 'points', 'devices', 'baselines', 'records', 'audits', 'rules', 'events', 'notifications', 'plans', 'tasks', 'issues', 'workOrders', 'attachments', 'maintenancePlans', 'maintenanceTasks'] as const
export interface MigrationPackage {
  format: 'zhutong-migration-v1'
  schemaVersion: number
  sourceName: string
  exportedAt: string
  counts: Record<string, number>
  data: Record<string, LegacyRow[]>
  runtime: Record<string, unknown>
  warnings: MigrationProblem[]
}
export interface MigrationReport {
  valid: boolean
  sourceName: string
  sourceHash: string
  datasetId: string
  replayed?: boolean
  fieldsVerified: number
  filesVerified: number
  errors: MigrationProblem[]
  warnings: MigrationProblem[]
  tables: Record<string, { source: number; inserted: number; matched: number }>
}
export interface MigrationResult {
  sourceName: string
  datasetId: string
  status: 'imported' | 'blocked'
  report: MigrationReport
}
