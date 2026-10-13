import type { AskResult } from '../types'
import type { PreparationReceipt } from '@/core/demo/preparation/types'

export function receiptSummary(receipts: PreparationReceipt[]): string {
  return `实际新增 ${receipts.reduce((sum, row) => sum + row.created.length, 0)} 项，复用 ${receipts.reduce((sum, row) => sum + row.reused.length, 0)} 项`
}

/** 分析任务保留实际结论；准备回执只说明用了什么，不组织展示剧本。 */
export function presentMediaTask(result: AskResult, receipts: PreparationReceipt[]): AskResult {
  if (result.status !== 'answered') return result
  const visual = result.previews.find(row => row.kind === 'visual_evidence')
  if (visual?.kind !== 'visual_evidence') return result
  const summary = receiptSummary(receipts)
  return {
    ...result,
    facts: [
      { label: '任务执行', value: visual.pair === null ? '已核对监测记录，缺少可比照片对' : visual.results[visual.active] === null ? '已核对同测点照片，尚无区域差异计算结果' : '已读取监测记录、核对同测点照片并计算区域差异', unit: '' },
      { label: '素材准备', value: summary, unit: '' },
      ...result.facts,
    ],
    dataNotes: [...result.dataNotes, '重复分析复用已有证据；没有新的有效记录或影像时，事实数值保持一致，不生成虚假的新变化。'],
  }
}
