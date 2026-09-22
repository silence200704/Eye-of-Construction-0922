import type { Baseline, MetricKey } from '@/types/domain'
import { metricDef } from '@/types/catalog'
import type { FieldDef } from '@/types/forms'

/**
 * 基准值字段随指标变化：裂缝只设初始宽度，倾角设双轴基准，
 * 振动与温湿度按方案不设相对基准（振动为绝对判定指标）。
 */
export function baselineFields(metric: MetricKey, current: Baseline | undefined): FieldDef[] {
  const def = metricDef(metric)
  const fields: FieldDef[] = def.baselineFields.map((field) => ({
    key: field.key,
    label: field.key === 'width' ? '初始基准宽度' : field.label,
    type: 'number',
    required: true,
    unit: field.unit,
    step: field.step,
    placeholder: field.placeholder,
    hint: current === undefined ? def.baselineNote : `当前生效 v${current.version}，本次保存将生成 v${current.version + 1}`,
  }))

  fields.push(
    {
      key: 'effectiveFrom',
      label: '生效时间',
      type: 'datetime',
      required: true,
      hint: '修改只影响后续数据；历史记录仍按录入时的基准快照复算，不覆盖原证据',
    },
    { key: 'reason', label: '变更原因', type: 'textarea', span: 2, rows: 2, required: true, placeholder: '例如 经现场复核，基准按新安装位置重新确认' },
  )
  return fields
}
