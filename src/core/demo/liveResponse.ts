/** 红色预警现场演示的下一步提示，依据真实状态计算，不修改任何业务对象。 */
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'

export interface ResponseStage {
  step: number
  action: string
  owner: string
  hint: string
}

export function responseStageOf(input: {
  event: AlarmEvent | undefined
  issue: InspectionIssue | undefined
  order: WorkOrder | undefined
}): ResponseStage {
  const { event, issue, order } = input
  if (event === undefined) return { step: 0, action: '载入现场处置演示数据', owner: '演示者', hint: '先生成一条可操作的红色预警事件。' }
  if (event.status === 'closed') return { step: 7, action: '查看处置报告', owner: '安全管理人员', hint: '事件已授权关闭，问题与工单记录仍可追溯。' }
  if (event.status === 'pending') return { step: 1, action: '确认事件', owner: '学校安全管理人员', hint: '核对证据与现场位置，然后确认预警。' }
  if (issue === undefined) return { step: 2, action: '转问题处理', owner: '学校安全管理人员', hint: '带入事件编号与测点，登记现场核查问题。' }
  if (issue.status === 'pending_review') return { step: 3, action: '审核问题', owner: '学校安全管理人员', hint: '设备故障可转维修；疑似结构问题先转专业排查。' }
  if (order === undefined) return { step: 3, action: '查看审核去向', owner: '学校安全管理人员', hint: '只有选择转维修工单，才会自动生成待派工工单。' }
  if (order.status === 'created') return { step: 4, action: '派工', owner: '学校安全管理人员', hint: '指定维修人、期限和现场处理要求。' }
  if (order.status === 'assigned' || order.status === 'returned') {
    return { step: 5, action: order.status === 'returned' ? '返工接单' : '接单处理', owner: '维修人员', hint: '被指派人员接单；物业代接必须填写原因。' }
  }
  if (order.status === 'repairing') return { step: 5, action: '提交待验收', owner: '维修人员', hint: '填写维修措施和材料，附维修后照片。' }
  if (order.status === 'submitted') return { step: 6, action: '验收工单', owner: '学校安全管理人员', hint: '可退回返工；验收通过后问题进入待复查。' }
  if (issue.status === 'pending_recheck' && !(issue.rechecks ?? []).some((row) => row.outcome === null)) {
    return { step: 7, action: '登记复查', owner: '学校安全管理人员', hint: '写明事项、责任人和目标日期。' }
  }
  if (issue.status === 'pending_recheck' || issue.status === 'observing') {
    return { step: 7, action: '记录复查结论', owner: '学校安全管理人员', hint: '确认恢复、继续观察或复发转处置三选一。' }
  }
  if (event.status === 'recovering') return { step: 7, action: '授权关闭事件', owner: '学校安全管理人员', hint: '核对连续恢复复测与本事件关联工单的验收依据。' }
  return { step: 7, action: '等待恢复复测', owner: '学校安全管理人员', hint: '验收不自动关闭事件，仍需满足规则规定的恢复条件。' }
}
