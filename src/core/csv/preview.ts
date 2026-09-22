/**
 * CSV 导入的逐行校验与预览。
 *
 * 校验复用录入校验 checkReading，因此导入与手工录入的标准完全一致；
 * 错误行只在预览里出现，调用方不会把它们交给写入流程。
 */
import { CSV_QUALITY_TEXT, CSV_VALUE_COLUMNS, hasNumericReadings, metricDef } from '@/types/catalog'
import type { MetricValueKey, MetricValues, MonitorRecord, Point, QualityFlag } from '@/types/domain'
import type { MonitoringRule } from '@/types/rules'
import { ruleForPoint } from '@/core/rules'
import { isValidDateTime } from '@/core/time'
import { checkReading } from '@/core/validate'
import { cellOf, columnIndex, parseCsv, parseSampleTime, readTable, type CsvTable } from './parse'

export type ImportRowStatus = 'ok' | 'warn' | 'error'

export interface ImportPayload {
  pointId: string
  pointLabel: string
  sampleTime: string
  values: MetricValues
  unit: string
  sampleWindow: string
  quality: QualityFlag
  note: string
}

export interface ImportRowPreview {
  lineNo: number
  status: ImportRowStatus
  /** 通过或警告的行才带可导入数据；错误行为 null，不会被写入 */
  payload: ImportPayload | null
  summary: string
  messages: string[]
}

export interface ImportContext {
  points: Point[]
  rules: MonitoringRule[]
  existing: MonitorRecord[]
}

export interface ImportPreview {
  headerOk: boolean
  headerMissing: string[]
  rows: ImportRowPreview[]
  okCount: number
  warnCount: number
  errorCount: number
}

/** 表头缺少必需列时整份文件都不可导入。 */
function checkHeader(header: string[]): { ok: boolean; missing: string[] } {
  const missing = ['测点编号', '采样时间'].filter((name) => columnIndex(header, name) === -1)
  return { ok: missing.length === 0, missing }
}

/** 预览表左栏：这一行是谁、什么时候。 */
function rowSummary(cells: string[], header: string[]): string {
  const code = cellOf(cells, columnIndex(header, '测点编号'))
  const time = cellOf(cells, columnIndex(header, '采样时间'))
  return `${code || '（缺测点）'}｜${time || '（缺时间）'}`
}

/** 从这一行读出该指标用到的值；用不到的列不写入，避免把角度混进裂缝记录。 */
function readValues(point: Point, cells: string[], header: string[]): MetricValues {
  const values: MetricValues = {}
  for (const field of metricDef(point.metric).fields) {
    const column = CSV_VALUE_COLUMNS.find((item) => item.key === field.key)
    if (column === undefined) continue
    const raw = cellOf(cells, columnIndex(header, column.label))
    if (raw === '') continue
    const parsed = Number(raw)
    if (Number.isFinite(parsed)) values[field.key] = parsed
  }
  return values
}

/** 该行填了本指标用不到的列时提示一下，避免把角度填进裂缝行还以为是有效输入。 */
function strayColumns(point: Point, cells: string[], header: string[]): string[] {
  const used = new Set(metricDef(point.metric).fields.map((field) => field.key as MetricValueKey))
  return CSV_VALUE_COLUMNS.filter((column) => {
    if (used.has(column.key)) return false
    return cellOf(cells, columnIndex(header, column.label)) !== ''
  }).map((column) => column.label)
}

/**
 * 行级身份识别：表头、测点、指标类型、采样时间、同一份文件里的重复行。
 * 任一项不通过都直接判错，后面的数值读取不再进行。
 */
function readIdentity(input: {
  headerOk: boolean
  table: CsvTable
  ctx: ImportContext
  seen: Set<string>
  cells: string[]
}): { ok: true; point: Point; sampleTime: string } | { ok: false; message: string } {
  const { headerOk, table, ctx, seen, cells } = input
  if (!headerOk) return { ok: false, message: '表头缺少必需列' }
  const code = cellOf(cells, columnIndex(table.header, '测点编号'))
  const point = ctx.points.find((row) => row.code === code)
  if (point === undefined) return { ok: false, message: `测点编号 ${code} 在档案中不存在` }
  if (!hasNumericReadings(point.metric)) {
    return { ok: false, message: '该点位是人工检查点，不接受数值导入' }
  }
  const timeText = cellOf(cells, columnIndex(table.header, '采样时间'))
  const sampleTime = parseSampleTime(timeText)
  if (!isValidDateTime(sampleTime)) return { ok: false, message: `采样时间「${timeText}」无法解析` }

  // 同一测点同一分钟只保留一条，否则重复数据会互相盖掉判定依据
  const minuteKey = `${point.id}#${sampleTime.slice(0, 16)}`
  if (seen.has(minuteKey)) {
    return { ok: false, message: '同一份文件里该测点该分钟重复出现，保留第一条即可' }
  }
  seen.add(minuteKey)
  return { ok: true, point, sampleTime }
}

interface RowDetails {
  values: MetricValues
  unit: string
  sampleWindow: string
  quality: QualityFlag
  note: string
  /** 单位不属于该指标等阻断性问题；有值时该行判错 */
  fatal: string | null
  messages: string[]
}

/**
 * 读出该行的值、单位、统计窗口、质量标记与备注。
 * 单位留空按指标默认单位处理（并提示），填了别的指标的单位则判错。
 */
function readDetails(point: Point, cells: string[], header: string[]): RowDetails {
  const messages: string[] = []
  const def = metricDef(point.metric)
  const unitText = cellOf(cells, columnIndex(header, '单位'))
  const unit = unitText === '' ? def.unit : unitText
  if (unitText === '') {
    messages.push(`单位留空，按指标默认单位 ${def.unit} 处理`)
  } else if (!def.unitOptions.includes(unitText)) {
    return {
      values: {},
      unit,
      sampleWindow: '',
      quality: 'valid',
      note: '',
      fatal: `单位「${unitText}」不属于该指标，应为 ${def.unitOptions.join(' 或 ')}`,
      messages,
    }
  }

  const stray = strayColumns(point, cells, header)
  if (stray.length > 0) messages.push(`该测点用不到这些列，已忽略：${stray.join('、')}`)

  const qualityText = cellOf(cells, columnIndex(header, '质量标记')) || '有效'
  /*
   * 批量导入的行采样时间通常早于当前时间，会命中"补录必须填写说明"的校验。
   * 导入动作本身就是补录说明，因此这里先给出有效备注再进入校验，
   * 既不放过补录留痕，也不强求每行重复写一遍原因。
   */
  const rawNote = cellOf(cells, columnIndex(header, '备注'))
  return {
    values: readValues(point, cells, header),
    unit,
    sampleWindow: cellOf(cells, columnIndex(header, '统计窗口')),
    quality: (CSV_QUALITY_TEXT[qualityText] ?? 'valid') as QualityFlag,
    note: rawNote === '' ? 'CSV 批量导入' : `${rawNote}（CSV 批量导入）`,
    fatal: null,
    messages,
  }
}

/** 逐行校验。错误行只在预览里出现，调用方不会把它们交给写入流程。 */
export function buildImportPreview(table: CsvTable, ctx: ImportContext): ImportPreview {
  const headerCheck = checkHeader(table.header)
  const rows: ImportRowPreview[] = []
  const seen = new Set<string>()

  for (const item of table.data) {
    const summary = rowSummary(item.cells, table.header)
    const fail = (message: string): void => {
      rows.push({ lineNo: item.lineNo, status: 'error', payload: null, summary, messages: [message] })
    }

    const identity = readIdentity({ headerOk: headerCheck.ok, table, ctx, seen, cells: item.cells })
    if (!identity.ok) {
      fail(identity.message)
      continue
    }
    const { point, sampleTime } = identity

    const details = readDetails(point, item.cells, table.header)
    if (details.fatal !== null) {
      fail(details.fatal)
      continue
    }

    const check = checkReading(
      {
        pointId: point.id,
        metric: point.metric,
        values: details.values,
        unit: details.unit,
        sampleTime,
        sampleWindow: details.sampleWindow,
        quality: details.quality,
        qualityNote: details.note,
        note: details.note,
        excludeRecordId: null,
        device: undefined,
        enteredAt: new Date().toISOString(),
      },
      ctx.existing,
    )
    const messages = [...details.messages, ...check.issues.map((issue) => issue.message)]
    if (check.backfill) messages.push('采样时间早于当前时间，将标记为历史补录')
    if (check.outOfRange) messages.push('超出设备量程，将标记为无效并进入数据核查')
    if (ruleForPoint(ctx.rules, point, sampleTime) === undefined) {
      messages.push('该采样时间没有适用规则，本行只存档不判定')
    }

    const blocked = check.issues.length > 0
    rows.push({
      lineNo: item.lineNo,
      status: blocked ? 'error' : messages.length > 0 ? 'warn' : 'ok',
      payload: blocked
        ? null
        : {
            pointId: point.id,
            pointLabel: `${point.code} ${point.name}`,
            sampleTime,
            values: details.values,
            unit: details.unit,
            sampleWindow: details.sampleWindow,
            quality: check.outOfRange ? 'invalid' : details.quality,
            note: details.note,
          },
      summary,
      messages,
    })
  }

  return {
    headerOk: headerCheck.ok,
    headerMissing: headerCheck.missing,
    rows,
    okCount: rows.filter((row) => row.status === 'ok').length,
    warnCount: rows.filter((row) => row.status === 'warn').length,
    errorCount: rows.filter((row) => row.status === 'error').length,
  }
}

/** 文本 → 预览；上传文件与粘贴文本共用。 */
export function previewFromText(text: string, ctx: ImportContext): ImportPreview {
  return buildImportPreview(readTable(parseCsv(text)), ctx)
}
