import type { AlarmEvent } from '@/types/events'
import { EVENT_LEVEL_LABEL } from '@/types/events'
import type { InspectionIssue } from '@/types/inspection'
import type { ReplayNode } from '../types'
import { statusLabelOf } from '@/api/contract/states'

export function replayNodes(event: AlarmEvent, issues: InspectionIssue[]): ReplayNode[] {
  const evidence = [...(event.evidences ?? []), ...(event.supersededEvidences ?? []).map(row => row.evidence)].sort((a,b) => a.addedAt.localeCompare(b.addedAt))
  const nodes: ReplayNode[] = evidence.map((row,i) => ({
    id: `evidence-${i}`, at: row.addedAt, title: i === 0 ? '首次触发证据' : '触发证据', by: row.addedBy,
    recordNo: row.recordNo, level: EVENT_LEVEL_LABEL[row.level], ruleVersion: row.ruleVersion,
    thresholds: row.thresholds ? `黄 ${row.thresholds.yellow}／橙 ${row.thresholds.orange}／红 ${row.thresholds.red}` : '无数值阈值',
    detail: `${row.reason}；采样 ${row.sampleTime}；触发值 ${row.triggerValue}${event.unit}；基准 ${row.baselineValue ?? '无'}`,
  }))
  nodes.push(...(event.upgrades ?? []).map((row,i) => ({ id: `upgrade-${i}`, at: row.at, by: row.by,
    title: `${EVENT_LEVEL_LABEL[row.from]} → ${EVENT_LEVEL_LABEL[row.to]}`, detail: `触发值 ${row.triggerValue}${event.unit}`,
    recordNo: row.recordNo, ruleVersion: row.ruleVersion, level: EVENT_LEVEL_LABEL[row.to],
  })))
  nodes.push(...(event.supersededEvidences ?? []).map((row,i) => ({ id: `revision-${i}`, at: row.supersededAt,
    by: row.supersededBy, title: '证据修订替代', recordNo: row.evidence.recordNo, detail: row.reason })))
  nodes.push(...(event.timeline ?? []).map((row,i) => ({ id: `action-${i}`, ...row, title: row.action })))
  for (const issue of issues.filter(row => row.eventId === event.id)) for (const [i,round] of (issue.rechecks ?? []).entries()) {
    nodes.push({ id: `recheck-${issue.id}-${i}`, at: round.outcomeAt ?? round.at, by: round.outcomeBy || round.by,
      title: `问题 ${issue.issueNo} 复查`, detail: `${round.subject}；${round.outcome ? statusLabelOf('recheckOutcome',round.outcome) : '尚无结论'}；${round.outcomeNote ?? ''}` })
  }
  return nodes.sort((a,b) => a.at.localeCompare(b.at))
}
