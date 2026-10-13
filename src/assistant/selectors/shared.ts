/** 选择器共用的小工具：只放跨文件重复出现的排序与初始值。 */
import type { EventLevel } from '@/types/events'

export function emptyLevelCount(): Record<EventLevel, number> {
  return { yellow: 0, orange: 0, red: 0 }
}

/** 按给定字段降序（ISO 字符串直接比大小）；不改动入参数组。 */
export function sortedNewestFirst<T>(rows: T[], key: (row: T) => string): T[] {
  return [...rows].sort((a, b) => key(b).localeCompare(key(a)))
}
