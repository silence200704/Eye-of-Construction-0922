import type { AssistantSnapshot } from '../selectors'
import type { CaseMatch } from '../types'
import type { InspectionIssue } from '@/types/inspection'
import { statusLabelOf } from '@/api/contract/states'

export function completionGaps(issue: InspectionIssue, snapshot: AssistantSnapshot): string[] {
  const gaps: string[] = []
  if (issue.status !== 'closed') gaps.push(`问题尚未关闭（${statusLabelOf('issue',issue.status)}）`)
  if (!(issue.rechecks ?? []).some(row => row.outcome !== null)) gaps.push('缺少复查结论')
  if ((issue.rechecks ?? []).some(row => row.outcome === null)) gaps.push('仍有复查轮次未给结论')
  const orders = snapshot.details?.orders ?? []
  const linked = orders.filter(row => row.issueId === issue.id)
  for (const id of issue.workOrderIds) if (!linked.some(row => row.id === id)) gaps.push(`工单关联缺失：${id}`)
  for (const order of linked) if (order.status !== 'verified') gaps.push(`${order.orderNo} 尚未验收通过`)
  if (issue.eventId) {
    const event = snapshot.events.find(row => row.id === issue.eventId && row.pointId === issue.pointId)
    if (!event) gaps.push('关联事件缺失或测点不一致')
    else if (event.status !== 'closed') gaps.push('事件尚未关闭')
    if (linked.some(row => row.eventId !== issue.eventId)) gaps.push('工单与事件关联不一致')
  }
  return gaps
}

export function findCases(snapshot: AssistantSnapshot, current: { pointId: string; issueId?: string }): { total: number; rows: CaseMatch[] } {
  const point = snapshot.points.find(p => p.id === current.pointId)
  if (!point) return { total: 0, rows: [] }
  const issues = snapshot.details?.issues ?? []
  const currentIssue = issues.find(i => i.id === current.issueId)
  const rows = issues.filter(i => i.id !== current.issueId && i.pointId !== null && snapshot.points.find(p => p.id === i.pointId)?.metric === point.metric
    && (!currentIssue || i.anomalyType === currentIssue.anomalyType)).map(issue => {
    const gaps = completionGaps(issue, snapshot)
    const orders = (snapshot.details?.orders ?? []).filter(o => o.issueId === issue.id)
    return { issueId: issue.id, issueNo: issue.issueNo, eventId: issue.eventId, pointId: issue.pointId,
      complete: gaps.length === 0, gaps, reasons: ['同监测指标', ...(currentIssue ? ['同异常类型'] : []), ...(issue.buildingId === point.buildingId ? ['同楼栋'] : [])],
      measures: orders.map(o => `${o.orderNo}：${o.measures || '未填写措施'}`).join('；') || '无维修工单',
      recheck: (issue.rechecks ?? []).map(r => r.outcome ? `${statusLabelOf('recheckOutcome',r.outcome)}：${r.outcomeNote}` : '待复查').join('；') || '未登记复查', at: issue.updatedAt,
    }
  }).sort((a,b) => Number(b.reasons.includes('同楼栋')) - Number(a.reasons.includes('同楼栋')) || b.at.localeCompare(a.at))
  return { total: rows.length, rows: rows.slice(0,5) }
}
