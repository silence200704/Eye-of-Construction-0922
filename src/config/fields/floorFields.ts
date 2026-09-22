import type { FieldDef, FieldOption } from '@/types/forms'

export function floorFields(buildingOptions: FieldOption[]): FieldDef[] {
  return [
    { key: 'buildingId', label: '所属楼栋', type: 'select', required: true, options: buildingOptions },
    {
      key: 'floorNo',
      label: '楼层号',
      type: 'number',
      required: true,
      min: -3,
      max: 60,
      step: 1,
      hint: '负数表示地下层；楼层号与楼栋编号共同构成楼层编号',
    },
    { key: 'name', label: '楼层名称', type: 'text', required: true, placeholder: '例如 二层' },
    {
      key: 'zonesText',
      label: '区域名称',
      type: 'text',
      span: 2,
      required: true,
      placeholder: '二层走廊、二层东教室、二层楼梯间、二层西教室',
      hint: '以顿号分隔：第 1 项为走廊，其后依次对应左上、中上、右上、左下、中下、右下房间',
    },
    {
      key: 'planVersion',
      label: '底图版本',
      type: 'number',
      required: true,
      min: 1,
      max: 99,
      step: 1,
      hint: '楼层图换版后需先核对测点标记位置再发布，历史测点保留原底图版本号',
    },
    { key: 'remark', label: '备注', type: 'textarea', span: 2, rows: 2 },
  ]
}
