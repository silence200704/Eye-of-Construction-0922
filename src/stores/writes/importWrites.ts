/**
 * CSV 批量导入的写入侧。
 *
 * 校验与预览在 core/csv/（纯函数，可单独测试）；本文件只负责确认导入：
 * 逐条调用现有录入链路 records.addRecord，因此基准快照、规则判定、事件去重升级
 * 与通知与手工录入完全一致 —— 不另做一套导入判定。
 */
import type { ImportPreview } from '@/core/csv'
import type { AlertPromptEventInput } from '@/core/event/alertPrompt'
import { useArchiveStore } from '../archive'
import { useEventsStore } from '../events'
import { useRecordsStore } from '../records'

export interface ImportResult {
  imported: number
  skipped: number
  eventMessages: string[]
  /** 仅含本批次新建或升级的事件，供界面生成一条汇总提醒。 */
  alertInputs: AlertPromptEventInput[]
}

export interface ImportBatch {
  /** 上传时的原始文件名；粘贴文本时给一个可读的说明 */
  fileName: string
}

export async function runImport(preview: ImportPreview, batch: ImportBatch): Promise<ImportResult> {
  const records = useRecordsStore()
  const archive = useArchiveStore()
  const events = useEventsStore()
  const eventMessages: string[] = []
  const alertInputs: AlertPromptEventInput[] = []
  let imported = 0
  let skipped = 0

  for (const row of preview.rows) {
    if (row.payload === null) {
      skipped += 1
      continue
    }
    const payload = row.payload
    await records.addRecord({
      pointId: payload.pointId,
      deviceId: null,
      values: payload.values,
      unit: payload.unit,
      sampleTime: payload.sampleTime,
      sampleWindow: payload.sampleWindow,
      source: 'csv',
      quality: payload.quality,
      qualityNote: '',
      note: payload.note,
    })
    imported += 1
    if (records.lastEventMessage !== '' && !eventMessages.includes(records.lastEventMessage)) {
      eventMessages.push(records.lastEventMessage)
    }
    const outcome = records.lastEventOutcome
    const event = outcome.eventId === '' ? undefined : events.byId(outcome.eventId)
    if (event !== undefined) {
      alertInputs.push({ event, action: outcome.action, pointLabel: archive.pointLabel(payload.pointId) })
    }
  }

  /*
   * 审计留痕带上这一批的可核对信息：来源文件、写入与跳过条数、操作者（由 archive.log 记录）。
   * 导入是批量动作，出问题时必须能定位回是哪一份文件。
   */
  await archive.log(
    'import',
    'record',
    'csv',
    `CSV 批量导入（${batch.fileName}）`,
    `CSV 批量导入：写入 ${imported} 条，跳过错误行 ${skipped} 条`,
    `来源文件：${batch.fileName}；错误行只在预览中提示，不写入正式数据；写入走与手工录入相同的判定链路`,
  )
  return { imported, skipped, eventMessages, alertInputs }
}
