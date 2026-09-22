/**
 * CSV 导入模板。
 *
 * 统一表头 + 指标子集：任何测点都用同一份表头，只填该测点指标需要的值列。
 * 一份模板覆盖四种测点类型，换测点不必换模板。
 */
import { CSV_HEADER, CSV_VALUE_COLUMNS, POINT_TYPES, metricDef, pointTypeDef } from '@/types/catalog'
import { toCsv } from '@/core/csv'

export { CSV_HEADER, CSV_VALUE_COLUMNS }

/** 模板示例行：按测点类型给出该指标需要填的列，其余留空。 */
export function templateRow(pointCode: string, type: string): string[] {
  const def = pointTypeDef(type as never)
  const metric = metricDef(def.metric)
  const samples = metric.fields.map((field) => field.placeholder.replace('例如 ', ''))
  return [
    pointCode,
    '2026-09-20 09:00',
    ...CSV_VALUE_COLUMNS.map((column) => {
      const index = metric.fields.findIndex((field) => field.key === column.key)
      return index === -1 ? '' : samples[index]
    }),
    metric.unit,
    metric.key === 'vibration' ? '1 s' : '',
    '有效',
    '按示例行填写，可自行增行',
  ]
}

export function buildTemplate(pointCode: string, type: string): string {
  return toCsv([...CSV_HEADER], [templateRow(pointCode, type)])
}

/** 页面上的填写指引。 */
export function templateHint(): string {
  const types = POINT_TYPES.map(
    (item) => `${item.name}（${metricDef(item.metric).fields.map((f) => f.label).join('、') || '无数值字段'}）`,
  )
  return `值列只需填该测点指标需要的列。${types.join('；')}。`
}
