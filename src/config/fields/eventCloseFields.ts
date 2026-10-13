/** 预警事件关闭表单字段：与事件详情分开，避免详情组件继续膨胀。 */
export const eventCloseFields = [
  {
    key: 'basis',
    label: '关闭依据（复查结论）',
    type: 'textarea' as const,
    required: true,
    rows: 2,
    placeholder: '例如 连续三次复测均低于恢复阈值，现场复查无新增裂缝，经安全管理人员确认关闭',
  },
  {
    key: 'noRepairNote',
    label: '无需维修核查结论',
    type: 'textarea' as const,
    rows: 2,
    placeholder: '仅当没有关联工单时填写：现场核查确认无需维修的理由（不少于 10 字）',
    hint: '有关联工单且已验收通过时不用填；两者至少要成立一条，否则不能关闭',
  },
]
