/** 监测记录、试算与 CSV 的服务端适配。 */
import type { ImportPreview } from '@/core/csv'
import type { MetricKey, MetricValues, MonitorRecord, QualityFlag, RecordSource } from '@/types/domain'
import type { RuleAssessment } from '@/types/rules'
import { command, read } from './runtime'

export interface RecordDraftLike {
  pointId: string
  deviceId: string | null
  values: MetricValues
  unit: string
  sampleTime: string
  sampleWindow: string
  source: RecordSource
  quality: QualityFlag
  qualityNote: string
  note: string
}

export interface EventOutcome {
  action: 'created' | 'appended' | 'upgraded' | 'recovering' | 'none'
  eventId: string
  eventNo: string
  message: string
}

export interface CreateRecordResponse {
  record: MonitorRecord
  assessment: RuleAssessment | null
  event: EventOutcome
}

export interface BackendImportPreview extends ImportPreview {
  token: string
}

export interface ImportEvent {
  action: string
  eventId: string
  eventNo: string
  message: string
  pointId: string
}

export interface ImportCommitResponse {
  imported: number
  skipped: number
  eventMessages: string[]
  events: ImportEvent[]
  records: string[]
}

export async function fetchRecords(pointId?: string): Promise<MonitorRecord[]> {
  return read<MonitorRecord[]>('/records', { pointId })
}

export async function createRecordRemote(
  draft: RecordDraftLike, metric: MetricKey,
): Promise<CreateRecordResponse> {
  const result = await command<CreateRecordResponse>('/records', {
    body: draft,
    key: `record_write|${draft.pointId}|${draft.sampleTime}|${metric}`,
  })
  return result.data
}

export async function reviseRecordRemote(
  id: string, draft: RecordDraftLike, reason: string, expectedRev: number | undefined,
): Promise<CreateRecordResponse> {
  // 修订以路径中的 recordId 为准；pointId 不属于修订请求字段，不能透传给服务端。
  const { pointId: _pointId, ...rest } = draft
  const result = await command<CreateRecordResponse>(`/records/${id}/revisions`, {
    body: { ...rest, reason, expectedRev },
    key: `record_revise|${id}|${expectedRev ?? 0}`,
  })
  return result.data
}

export async function previewImportRemote(csvText: string): Promise<BackendImportPreview> {
  const result = await command<BackendImportPreview>('/records/import-preview', {
    body: { csvText },
    key: `import_preview|${csvText.length}|${csvText.slice(0, 80)}`,
  })
  return result.data
}

export async function commitImportRemote(input: {
  csvText: string
  token: string
  lineNos: number[]
  fileName: string
}): Promise<ImportCommitResponse> {
  const result = await command<ImportCommitResponse>('/records/import', {
    body: input,
    key: `record_import|${input.token}|${input.lineNos.join(',')}`,
  })
  return result.data
}
