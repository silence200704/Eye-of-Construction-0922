/**
 * 看板共用的口径文案。
 *
 * 卡片墙与异常队列必须用同一套措辞，否则同一份数据在两个区块里会被读成两种意思
 * （最典型的是"没有读数"到底算不算"正常"）。
 */

export const EMPTY_NOTE = {
  /** 没有有效读数时的占位：不写"正常"，写清缺什么 */
  noReading: '无有效读数',
  /** 没有有效读数时的解释 */
  noReadingHint: '没有有效读数就无法给出风险状态；请先补录有效数据。',
} as const

/** 无心跳的口径：凡是展示设备状态的地方都要带上 */
export const NO_HEARTBEAT_NOTE =
  '本机不接入设备心跳：设备状态一律是档案里人工登记的字段，"未接入"就是没有自动心跳，不能读成设备离线或在线。'

/**
 * 卡片上的设备状态写法。
 *
 * 刻意**不出现"在线"**这个词：本机没有设备心跳，写"在线"就会被读成实时连接状态。
 * 人工登记的三种状态在这里改写成"人工登记：…（无自动心跳）"，与监测读数分开呈现。
 */
export function deviceStatusText(health: 'unknown' | 'online' | 'offline' | 'none'): string {
  if (health === 'none') return '无绑定设备'
  if (health === 'unknown') return '未接入（无设备心跳）'
  if (health === 'online') return '人工登记：正常（无自动心跳）'
  return '人工登记：需排查（无自动心跳）'
}

/** 队列与卡片的事件计数口径 */
export const EVENT_COUNT_NOTE =
  '未关闭事件按事件 ID 去重：一次升级只改同一条事件，不会重复计数；计数与预警中心、小瞳回答同源。'
