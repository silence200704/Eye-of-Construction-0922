import { db } from '@/db/database'
import { usePreparationSession } from '@/stores/demo/preparation/session'
import { buildSnapshot } from '../selectors'
import { assembleAnswer } from '../ask'
import { buildLink } from '../actions'
import { draft } from '../answers/shared'
import type { AskResult } from '../types'
import type { PreparationObject } from '@/core/demo/preparation/types'
import { CHECK_STATUSES } from '@/types/inspection'
import { associateEventChain } from '../guide/chain'

/** 回执按主键去重，只核对本次请求集合，绝不拿全库总数冒充本次新增。 */
export async function directorReceipt(question: string): Promise<AskResult> {
  const session = usePreparationSession()
  const snapshot = buildSnapshot()
  const created = unique(session.receipts.flatMap((row) => row.created))
  const createdKeys = new Set(created.map((row) => `${row.kind}:${row.id}`))
  const reused = unique(session.receipts.flatMap((row) => row.reused)).filter((row) => !createdKeys.has(`${row.kind}:${row.id}`))
  const failures = session.receipts.flatMap((row) => row.failed)
  const points = new Set(session.receipts.map((row) => row.pointId))
  const events = snapshot.events.filter((row) => points.has(row.pointId))
  const verified = events.map((event) => ({ event, chain: associateEventChain(snapshot, event.id) }))
  const taskIds = [...created, ...reused].filter((row) => row.kind === 'task').map((row) => row.id)
  const tasks = await db.tasks.bulkGet(taskIds)
  return assembleAnswer(question, 'demo_command', draft(
    `本次任务请求 ${session.receipts.length} 次：新增 ${created.length} 项，复用 ${reused.length} 项。${session.active ? '会话仍有效。' : '自动补齐已停止。'}`,
    {
      facts: [
        { label: '实际新增', value: String(created.length), unit: '项' },
        { label: '实际复用', value: String(reused.length), unit: '项' },
        { label: '跳过', value: String(session.receipts.reduce((count, row) => count + row.skipped.length, 0)), unit: '次' },
        { label: '失败或拦截', value: String(session.receipts.filter((row) => row.status !== 'ready').length), unit: '次' },
        ...[...created.map((row) => ({ row, action: '新增' })), ...reused.map((row) => ({ row, action: '复用' }))].map(({ row, action }) => ({ label: `${action} · ${row.source}`, value: `${row.label}（${row.id}）`, unit: '' })),
        ...verified.map(({ event, chain }) => ({ label: `关联核对 · ${event.eventNo}`, value: chain.gaps.length > 0 ? chain.gaps.join('；') : `${chain.issues.map((row) => row.issueNo).join(' / ') || '尚未转问题'} → ${chain.orders.map((row) => row.orderNo).join(' / ') || '尚无工单'}`, unit: '' })),
        ...tasks.filter((row) => row !== undefined).map((row) => ({ label: `模拟 NFC · ${row.taskNo}`, value: row.results.map((result) => `${result.pointId}：${CHECK_STATUSES.find((status) => status.key === result.status)?.name ?? result.status}；读卡尝试 ${result.attempts.length} 次`).join(' / '), unit: '' })),
      ],
      gaps: failures,
      links: [buildLink('settings')],
      dataNotes: ['对账仅包含本次小瞳按需请求，不重复计入设置页初始化全链。照片只存当前会话，采样为预设演示数据；模拟 NFC 不构成真实到场证明。'],
    }), snapshot)
}

function unique(rows: PreparationObject[]): PreparationObject[] {
  return [...new Map(rows.map((row) => [`${row.kind}:${row.id}`, row])).values()]
}
