import type { FieldDef, FieldOption } from '@/types/forms'
import { STRUCTURE_TYPES } from '@/types/catalog'

function toOptions(values: string[]): FieldOption[] {
  return values.map((value) => ({ value, label: value }))
}

/** 楼栋档案字段；校园图上的位置由地图交互维护，不作为表单字段。 */
export function buildingFields(): FieldDef[] {
  return [
    {
      key: 'code',
      label: '楼栋编号',
      type: 'text',
      required: true,
      placeholder: '例如 B03',
      hint: '统一关联入口，连接楼层图、测点、设备与后续业务记录',
    },
    { key: 'name', label: '楼栋名称', type: 'text', required: true, placeholder: '例如 3号教学楼' },
    { key: 'purpose', label: '用途', type: 'text', placeholder: '例如 教学 / 办公 / 实验' },
    { key: 'structureType', label: '结构形式', type: 'select', options: toOptions(STRUCTURE_TYPES) },
    { key: 'buildYear', label: '建设年份', type: 'number', min: 1900, max: 2100, step: 1, placeholder: '例如 2009' },
    { key: 'floorCount', label: '层数', type: 'number', min: -3, max: 60, step: 1, unit: '层' },
    { key: 'area', label: '建筑面积', type: 'number', min: 0, step: 1, unit: '㎡' },
    { key: 'managerUnit', label: '管理单位', type: 'text', placeholder: '例如 后勤保障处' },
    { key: 'userUnit', label: '使用单位', type: 'text' },
    { key: 'owner', label: '楼栋负责人', type: 'text' },
    { key: 'ownerPhone', label: '值班联系电话', type: 'text' },
    { key: 'backupPerson', label: '替补人员', type: 'text' },
    {
      key: 'source',
      label: '资料来源',
      type: 'text',
      span: 2,
      placeholder: '例如 学校基建资料 / 现场核对',
      hint: '未确认的字段可以留空，页面按“待补充”显示并纳入建档待办',
    },
    {
      key: 'dataSource',
      label: '数据性质',
      type: 'select',
      required: true,
      options: [
        { value: 'real', label: '实测建档' },
        { value: 'demo', label: '示例数据' },
      ],
      hint: '实测点与演示数据必须在图上明确区分',
    },
    { key: 'remark', label: '备注', type: 'textarea', span: 2, rows: 2 },
  ]
}
