import type { RuleThresholds } from '@/types/rules'
/** 保存与候选试算共享；保留原来允许相等阈值的行为。 */
export function validateThresholds(value: RuleThresholds): string {
  if (![value.yellow, value.orange, value.red].every(Number.isFinite)) return '阈值必须是有限数值'
  if (!(value.yellow <= value.orange && value.orange <= value.red)) return '阈值必须满足 黄色 ≤ 橙色 ≤ 红色'
  return ''
}
