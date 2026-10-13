import { P_CRACK, P_TH, P_TILT, P_VIB, D_CRACK, D_TH, D_TILT, D_VIB } from '@/db/seedFactories'
import type { Capability } from './types'

/** 只允许已有剧本的四个数值测点，不能把任意真实档案当预设数据发生器。 */
export const PREPARATION_TARGETS = [
  { id: P_CRACK, deviceId: D_CRACK, code: 'B03-F2-CRACK01', metric: 'crack_width' },
  { id: P_TILT, deviceId: D_TILT, code: 'B03-F2-TILT01', metric: 'tilt_xy' },
  { id: P_VIB, deviceId: D_VIB, code: 'B03-F2-VIB01', metric: 'vibration' },
  { id: P_TH, deviceId: D_TH, code: 'B03-F2-TH01', metric: 'temp_humidity' },
] as const
export const PREPARATION_CAPABILITIES: Capability[] = ['sampling', 'media', 'inspection']
export const SAMPLE_WINDOW_MS = 30 * 60_000
export const INSPECTION_PLAN_MARK = '小瞳按需准备：待办演示，不自动签到或填写结果'

export function permitsTarget(capability: Capability, pointId: string): boolean {
  return PREPARATION_TARGETS.some((row) => row.id === pointId)
    && (capability !== 'media' || pointId === P_CRACK)
}
