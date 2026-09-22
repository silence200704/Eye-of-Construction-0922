import { DEVICE_HEALTH_OPTIONS } from '@/types/catalog'
import type { FieldDef, FieldOption } from '@/types/forms'

export function deviceFields(pointOptions: FieldOption[]): FieldDef[] {
  return [
    { key: 'code', label: '设备编号', type: 'text', required: true, placeholder: '例如 B03-F2-CRACK01-DEV1' },
    { key: 'name', label: '设备名称', type: 'text', required: true, placeholder: '例如 裂缝位移探头' },
    { key: 'pointId', label: '绑定测点', type: 'select', required: true, options: pointOptions },
    { key: 'model', label: '型号', type: 'text', placeholder: '例如 KTC2 25mm 电位式位移探头' },
    { key: 'serial', label: '序列号', type: 'text' },
    {
      key: 'rangeMin',
      label: '量程下限',
      type: 'number',
      step: 0.001,
      placeholder: '例如 0',
      hint: '与上限共同用于超量程判定；两者留空表示未登记量程，不做超量程检查',
    },
    { key: 'rangeMax', label: '量程上限', type: 'number', step: 0.001, placeholder: '例如 25' },
    { key: 'unit', label: '输出单位', type: 'text', placeholder: '例如 mm', hint: '显示为“量程 下限~上限 单位”' },
    { key: 'nodeId', label: '采集节点', type: 'text', placeholder: '例如 Hi3861-01' },
    { key: 'gateway', label: '所属网关', type: 'text', placeholder: '例如 DAYU200 楼栋网关-03' },
    { key: 'mountPosition', label: '安装位置', type: 'text', span: 2, placeholder: '例如 二层走廊西墙，裂缝两侧基面' },
    { key: 'direction', label: '安装方向', type: 'text', placeholder: '例如 垂直于裂缝走向' },
    {
      key: 'health',
      label: '设备状态',
      type: 'select',
      options: DEVICE_HEALTH_OPTIONS.map((item) => ({ value: item.value, label: item.label })),
      hint: 'V0.1 为人工登记；自动心跳与故障数据在后续版本接入，未接入前不得显示为在线',
    },
    { key: 'installDate', label: '安装日期', type: 'date' },
    { key: 'calibratedAt', label: '校准日期', type: 'date' },
    { key: 'remark', label: '备注', type: 'textarea', span: 2, rows: 2 },
  ]
}
