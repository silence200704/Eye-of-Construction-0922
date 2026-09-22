/**
 * CSV 解析与导入校验测试。
 * 重点：解析边界、逐行校验的六类问题、错误行不产生可写入数据。
 */
import { describe, expect, it } from 'vitest'
import { buildImportPreview, parseCsv, parseSampleTime, readTable, toCsv, cellOf, columnIndex } from '@/core/csv'
import { buildTemplate, templateRow } from '@/config/csvTemplate'
import { CSV_HEADER } from '@/types/catalog'
import { makePoint, makeRecord, makeRule } from './fixtures'

/* ---------------- 解析边界 ---------------- */

describe('CSV 解析', () => {
  it('按逗号与换行拆行拆列', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('支持 CRLF 与末尾空行', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('带引号的字段里可以含逗号', () => {
    expect(parseCsv('a,b\n"x,y",2')).toEqual([
      ['a', 'b'],
      ['x,y', '2'],
    ])
  })

  it('引号内的换行不断行', () => {
    expect(parseCsv('a,b\n"第一行\n第二行",2')).toEqual([
      ['a', 'b'],
      ['第一行\n第二行', '2'],
    ])
  })

  it('两个连续引号还原为一个引号', () => {
    expect(parseCsv('a\n"说""明"')).toEqual([['a'], ['说"明']])
  })

  it('去掉 BOM，中文表头不受影响', () => {
    expect(parseCsv('\uFEFF测点编号,采样时间\nA,1')[0]).toEqual(['测点编号', '采样时间'])
  })

  it('完全空白的行被丢弃', () => {
    expect(parseCsv('a,b\n\n  \n1,2')).toHaveLength(2)
  })

  it('表头与数据行可拆开并保留原始行号', () => {
    const table = readTable(parseCsv('a,b\n1,2\n3,4'))
    expect(table.header).toEqual(['a', 'b'])
    expect(table.data.map((row) => row.lineNo)).toEqual([2, 3])
  })

  it('导出时对含逗号与引号的字段加引号转义', () => {
    const csv = toCsv(['a', 'b'], [['x,y', '含"引号"']])
    expect(csv).toBe('a,b\r\n"x,y","含""引号"""')
    // 再解析回来应当一致
    expect(parseCsv(csv)).toEqual([
      ['a', 'b'],
      ['x,y', '含"引号"'],
    ])
  })

  it('按表头名取列，列不存在时返回空串而不是抛错', () => {
    const header = ['测点编号', '采样时间']
    expect(columnIndex(header, '采样时间')).toBe(1)
    expect(columnIndex(header, '备注')).toBe(-1)
    expect(cellOf(['A', '2026-09-20'], 1)).toBe('2026-09-20')
    expect(cellOf(['A', '2026-09-20'], -1)).toBe('')
  })

  it('采样时间兼容空格分隔与 ISO 两种写法', () => {
    expect(parseSampleTime('2026-09-20 09:00')).toBe(new Date('2026-09-20T09:00').toISOString())
    expect(parseSampleTime('2026-09-20T09:00')).toBe(new Date('2026-09-20T09:00').toISOString())
    expect(parseSampleTime('不是时间')).toBe('')
  })
})

/* ---------------- 逐行校验 ---------------- */

const POINT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01' })
const RULE = makeRule({ pointIds: ['pnt_1'], effectiveFrom: '2026-09-01T00:00:00.000Z' })
const CTX = { points: [POINT], rules: [RULE], existing: [] as ReturnType<typeof makeRecord>[] }

/** 当前本地时间，形如 2026-09-20 15:30；用于构造"不算历史补录"的用例。 */
function nowText(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 生成一行数据；只用测点编号、采样时间、裂缝宽度、单位、质量、备注，其余列留空。 */
function row(values: { code?: string; time?: string; width?: string; unit?: string; quality?: string }): string {
  const cells = CSV_HEADER.map((name) => {
    if (name === '测点编号') return values.code ?? 'B03-F2-CRACK01'
    if (name === '采样时间') return values.time ?? nowText()
    if (name === '裂缝宽度') return values.width ?? '0.62'
    if (name === '单位') return values.unit ?? 'mm'
    if (name === '质量标记') return values.quality ?? '有效'
    return ''
  })
  return cells.join(',')
}

function preview(text: string) {
  return buildImportPreview(readTable(parseCsv(text)), CTX)
}

describe('逐行校验', () => {
  it('合法行通过，并给出可写入的数据', () => {
    const result = preview(`${CSV_HEADER.join(',')}\n${row({})}`)
    expect(result.errorCount).toBe(0)
    expect(result.rows[0].status).toBe('ok')
    expect(result.rows[0].payload?.values.width).toBe(0.62)
    expect(result.rows[0].payload?.pointId).toBe('pnt_1')
  })

  it('测点编号不存在时判错，且不产生可写入数据', () => {
    const result = preview(`${CSV_HEADER.join(',')}\n${row({ code: 'B99-X' })}`)
    expect(result.rows[0].status).toBe('error')
    expect(result.rows[0].messages[0]).toContain('不存在')
    expect(result.rows[0].payload).toBeNull()
  })

  it('采样时间无法解析时判错', () => {
    const result = preview(`${CSV_HEADER.join(',')}\n${row({ time: '昨天' })}`)
    expect(result.rows[0].status).toBe('error')
    expect(result.rows[0].messages[0]).toContain('无法解析')
  })

  it('缺必填值（缺项不按零处理）时判错', () => {
    const result = preview(`${CSV_HEADER.join(',')}\n${row({ width: '' })}`)
    expect(result.rows[0].status).toBe('error')
    expect(result.rows[0].messages.join('；')).toContain('缺项不按零处理')
  })

  it('数值超出合理区间时判错', () => {
    const result = preview(`${CSV_HEADER.join(',')}\n${row({ width: '-3' })}`)
    expect(result.rows[0].status).toBe('error')
  })

  it('单位留空时按默认单位处理并提示，不算错误', () => {
    const result = preview(`${CSV_HEADER.join(',')}
${row({ unit: '' })}`)
    expect(result.rows[0].status).toBe('warn')
    expect(result.rows[0].messages.join('；')).toContain('默认单位')
    expect(result.rows[0].payload?.unit).toBe('mm')
  })

  it('单位不属于该指标时判错，避免把 g 当 m/s² 记进裂缝数据', () => {
    const result = preview(`${CSV_HEADER.join(',')}
${row({ unit: 'g' })}`)
    expect(result.rows[0].status).toBe('error')
    expect(result.rows[0].messages[0]).toContain('不属于该指标')
  })

  it('与已有记录同一分钟重复时判错', () => {
    const existing = [makeRecord({ id: 'e1', pointId: 'pnt_1', sampleTime: new Date(nowText().replace(' ', 'T')).toISOString() })]
    const result = buildImportPreview(readTable(parseCsv(`${CSV_HEADER.join(',')}\n${row({})}`)), {
      ...CTX,
      existing,
    })
    expect(result.rows[0].status).toBe('error')
    expect(result.rows[0].messages.join('；')).toContain('已有记录')
  })

  it('同一份文件内重复的行只保留第一条', () => {
    const text = `${CSV_HEADER.join(',')}\n${row({})}\n${row({ width: '0.7' })}`
    const result = preview(text)
    expect(result.rows[0].status).toBe('ok')
    expect(result.rows[1].status).toBe('error')
    expect(result.rows[1].messages[0]).toContain('重复出现')
  })

  it('没有适用规则的采样时间给出警告但仍可导入', () => {
    const result = buildImportPreview(readTable(parseCsv(`${CSV_HEADER.join(',')}\n${row({ time: '2026-08-01 09:00' })}`)), CTX)
    expect(result.rows[0].status).toBe('warn')
    expect(result.rows[0].messages.join('；')).toContain('没有适用规则')
    expect(result.rows[0].payload).not.toBeNull()
  })

  it('历史时间的数据给出补录提示', () => {
    const result = preview(`${CSV_HEADER.join(',')}\n${row({ time: '2026-09-01 09:00' })}`)
    expect(result.rows[0].messages.join('；')).toContain('历史补录')
    expect(result.rows[0].payload).not.toBeNull()
  })

  it('填了本指标用不到的列时提示已忽略，不影响通过', () => {
    const cells = CSV_HEADER.map((name) => {
      if (name === '测点编号') return 'B03-F2-CRACK01'
      if (name === '采样时间') return '2026-09-20 09:00'
      if (name === '裂缝宽度') return '0.62'
      if (name === '单位') return 'mm'
      if (name === 'X 轴角度') return '0.3'
      return ''
    })
    const result = preview(`${CSV_HEADER.join(',')}\n${cells.join(',')}`)
    expect(result.rows[0].status).toBe('warn')
    expect(result.rows[0].messages.join('；')).toContain('用不到这些列')
    // 角度不会被写进裂缝记录
    expect(result.rows[0].payload?.values.angleX).toBeUndefined()
  })

  it('表头缺必需列时整份文件判错', () => {
    const result = preview(`裂缝宽度,单位\n0.62,mm`)
    expect(result.headerOk).toBe(false)
    expect(result.headerMissing).toEqual(['测点编号', '采样时间'])
    expect(result.rows.every((r2) => r2.status === 'error')).toBe(true)
  })

  it('人工检查点不接受数值导入', () => {
    const manual = makePoint({ id: 'pnt_m', code: 'B03-F1-CHECK01', metric: 'inspection', type: 'manual_check' })
    const result = buildImportPreview(
      readTable(parseCsv(`${CSV_HEADER.join(',')}\n${row({ code: 'B03-F1-CHECK01' })}`)),
      { ...CTX, points: [manual] },
    )
    expect(result.rows[0].status).toBe('error')
    expect(result.rows[0].messages[0]).toContain('人工检查点')
  })

  it('统计正确：通过 / 警告 / 错误分别计数', () => {
    const text = [
      CSV_HEADER.join(','),
      row({}),
      // 早于当前时间，且晚于规则生效时间 → 只命中"历史补录"一条提示
      row({ time: '2026-09-05 09:00', width: '0.7' }),
      row({ code: 'B99-X' }),
    ].join('\n')
    const result = preview(text)
    expect(result.okCount).toBe(1)
    expect(result.warnCount).toBe(1)
    expect(result.errorCount).toBe(1)
    expect(result.rows[1].messages.join('；')).toContain('历史补录')
    // 错误行不产生可写入数据，只有通过行和警告行进入导入队列
    expect(result.rows.filter((r2) => r2.payload !== null)).toHaveLength(2)
  })
})

/* ---------------- 模板 ---------------- */

describe('导入模板', () => {
  it('表头含测点编号、采样时间与全部值列', () => {
    const csv = buildTemplate('B03-F2-CRACK01', 'crack')
    const [header] = parseCsv(csv)
    expect(header).toEqual(CSV_HEADER)
    expect(header).toContain('裂缝宽度')
    expect(header).toContain('X 轴角度')
    expect(header).toContain('温度')
  })

  it('示例行只填该指标需要的值列，其余留空', () => {
    const cells = templateRow('B03-F2-CRACK01', 'crack')
    const widthIndex = CSV_HEADER.indexOf('裂缝宽度')
    const angleIndex = CSV_HEADER.indexOf('X 轴角度')
    expect(cells[widthIndex]).toBe('0.62')
    expect(cells[angleIndex]).toBe('')
  })

  it('模板能直接解析成合法预览（说明示例值本身可用）', () => {
    const csv = buildTemplate('B03-F2-CRACK01', 'crack')
    const result = preview(csv)
    expect(result.headerOk).toBe(true)
    expect(result.rows[0].status).not.toBe('error')
  })
})
