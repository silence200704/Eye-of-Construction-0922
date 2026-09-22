import type { Building, Floor } from '@/types/domain'
import { POINT_TYPES } from '@/types/catalog'
import type { FieldDef, FieldOption } from '@/types/forms'

export interface PointFormContext {
  buildings: Building[]
  floorsOf: (buildingId: string) => Floor[]
  zonesOf: (floorId: string) => string[]
}

/** 测点档案字段；楼层与区域选项随楼栋、楼层联动。 */
export function pointFields(ctx: PointFormContext): FieldDef[] {
  const buildingOptions: FieldOption[] = ctx.buildings.map((row) => ({
    value: row.id,
    label: `${row.code} ${row.name}`,
  }))

  return [
    {
      key: 'code',
      label: '测点编号',
      type: 'text',
      required: true,
      placeholder: '例如 B03-F2-CRACK01',
      hint: '按 楼栋编号-楼层-类型-序号 生成，编号在档案中唯一',
    },
    { key: 'name', label: '测点名称', type: 'text', required: true, placeholder: '例如 二层走廊西墙裂缝测点' },
    { key: 'buildingId', label: '所属楼栋', type: 'select', required: true, options: buildingOptions },
    {
      key: 'floorId',
      label: '所在楼层',
      type: 'select',
      required: true,
      options: (model) => {
        const buildingId = String(model.buildingId ?? '')
        if (buildingId === '') return []
        return ctx.floorsOf(buildingId).map((row) => ({ value: row.id, label: row.name }))
      },
    },
    {
      key: 'zoneId',
      label: '所在区域',
      type: 'select',
      required: true,
      options: (model) => {
        const floorId = String(model.floorId ?? '')
        if (floorId === '') return []
        return ctx.zonesOf(floorId).map((zone) => ({ value: zone, label: zone }))
      },
      hint: '区域用于在楼层图上定位，也决定后续检查任务的必查点归属',
    },
    {
      key: 'type',
      label: '测点类型',
      type: 'select',
      required: true,
      options: POINT_TYPES.map((item) => ({ value: item.key, label: item.name })),
      hint: '类型决定录入字段与判定指标，建档后不可随意更改',
    },
    {
      key: 'nfcLabel',
      label: 'NFC 标签编号',
      type: 'text',
      placeholder: '例如 NFC-B03-F2-CRACK01',
      hint: '一个编号只能绑一个测点；留空表示暂不绑定，打卡时只能人工兜底。纯前端阶段读卡为模拟',
    },
    { key: 'owner', label: '点位责任人', type: 'text' },
    { key: 'backupPerson', label: '替补人员', type: 'text' },
    { key: 'installDate', label: '安装日期', type: 'date' },
    {
      key: 'dataSource',
      label: '数据性质',
      type: 'select',
      required: true,
      options: [
        { value: 'real', label: '实测建档' },
        { value: 'demo', label: '示例数据' },
      ],
    },
    { key: 'remark', label: '备注', type: 'textarea', span: 2, rows: 2 },
  ]
}
