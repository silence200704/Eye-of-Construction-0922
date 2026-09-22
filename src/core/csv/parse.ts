/**
 * CSV 解析与导出。
 *
 * 只做纯粹的文本 ↔ 二维数组转换，不涉及业务校验：
 * 支持带引号的字段（引号内可含逗号与换行）、转义双引号、BOM、CRLF 与末尾空行。
 * 业务校验在 preview.ts 里逐行完成。
 */

/** 解析 CSV 文本为行数组；空行被丢弃，字段两侧空白保留给业务层判断。 */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index]
    if (inQuotes) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (char === '\r') continue
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }
  row.push(field)
  rows.push(row)

  // 去掉完全空白的行（含文件末尾的空行）
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''))
}

export interface CsvTable {
  header: string[]
  rows: string[][]
  /** 第一行之后的数据行，附带原始行号（含表头，从 1 开始） */
  data: { lineNo: number; cells: string[] }[]
}

/** 拆出表头与数据行，并保留原始行号用于错误提示。 */
export function readTable(rows: string[][]): CsvTable {
  if (rows.length === 0) return { header: [], rows: [], data: [] }
  const [header, ...rest] = rows
  return {
    header: header.map((cell) => cell.trim()),
    rows: rest,
    // 行号 = 在原始文本中的行序，表头是第 1 行
    data: rest.map((cells, index) => ({ lineNo: index + 2, cells })),
  }
}

/** 按表头名取列下标；-1 表示文件里没有这一列。 */
export function columnIndex(header: string[], name: string): number {
  return header.findIndex((cell) => cell === name)
}

/** 取某一行的某列值；列不存在时返回空串。 */
export function cellOf(row: string[], index: number): string {
  if (index < 0) return ''
  return (row[index] ?? '').trim()
}

/** 生成 CSV 文本（导出与模板下载用），必要时给字段加引号。 */
export function toCsv(header: string[], rows: string[][]): string {
  const escape = (value: string): string =>
    /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  return [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
}

/** 兼容 "2026-09-20 09:00" 与 ISO 两种写法；无法解析时返回空串。 */
export function parseSampleTime(text: string): string {
  const normalized = text.includes('T') ? text : text.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
