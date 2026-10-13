import { db } from '@/db/database'
import { useMediaStore } from '@/stores/media'
import { INSPECTION_PLAN_MARK } from '@/core/demo/preparation/policy'
import type { PreparationObject, PreparationReceipt } from '@/core/demo/preparation/types'
import { frameOriginLabel } from '@/types/media'

export async function preparationObjects(pointId: string): Promise<PreparationObject[]> {
  const [records, plans, tasks] = await db.transaction('r', db.records, db.plans, db.tasks, async () =>
    Promise.all([db.records.where('pointId').equals(pointId).toArray(), db.plans.toArray(), db.tasks.toArray()]))
  return [
    ...records.map((row) => ({ kind: 'record' as const, id: row.id, label: row.recordNo, source: row.source === 'device' ? '传感器采样（演示）' : row.source })),
    ...plans.filter((row) => row.remark === INSPECTION_PLAN_MARK && row.pointIds.includes(pointId)).map((row) => ({ kind: 'plan' as const, id: row.id, label: row.code, source: '演示巡检计划' })),
    ...tasks.filter((row) => row.results.some((result) => result.pointId === pointId)).map((row) => ({ kind: 'task' as const, id: row.id, label: row.taskNo, source: '巡检待办（未自动签到）' })),
    ...useMediaStore().framesOf(pointId).map((row) => ({ kind: 'frame' as const, id: row.id, label: row.fileName, source: frameOriginLabel(row.origin) })),
  ]
}

/** 按真实主键差集报新增；失败也保留已经提交的对象，不谎称整体回滚。 */
export function finishReceipt(receipt: PreparationReceipt, before: PreparationObject[], after: PreparationObject[], existingIds: string[]): void {
  const known = new Set(before.map((row) => `${row.kind}:${row.id}`))
  receipt.created = after.filter((row) => !known.has(`${row.kind}:${row.id}`))
  receipt.reused = after.filter((row) => existingIds.includes(row.id))
}
