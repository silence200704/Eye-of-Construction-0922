/** 看板共享的只读响应式快照；store 更新后卡片与队列一同重算。 */
import { computed } from 'vue'
import { buildSnapshot } from '@/assistant/selectors'
import { openEvents } from '@/assistant/selectors'
import type { AssistantSnapshot } from '@/assistant/selectors'

export function useDashboardSnapshot() {
  return computed(buildSnapshot)
}

/** 筛选摘要与卡墙、异常队列用同一批测点，避免显示全校时间/事件数。 */
export function dashboardSummaryOf(snapshot: AssistantSnapshot, pointIds: string[]) {
  const scope = new Set(pointIds)
  const records = snapshot.records.filter((row) => scope.has(row.pointId))
  const valid = records.filter((row) => row.quality === 'valid')
  return {
    sample: [...valid].sort((a, b) => b.sampleTime.localeCompare(a.sampleTime))[0]?.sampleTime ?? '',
    entered: [...records].sort((a, b) => b.enteredAt.localeCompare(a.enteredAt))[0]?.enteredAt ?? '',
    openTotal: openEvents(snapshot.events).filter((row) => scope.has(row.pointId)).length,
  }
}
