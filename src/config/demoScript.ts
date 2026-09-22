/**
 * 一键演示脚本。
 *
 * 数值与时间间隔直接取自项目组《筑瞳 Demo 演示预警规则 V1.0》的演示数据脚本：
 * 每天一条、维修后三条同分钟级复测。时间间隔是刻意的 ——
 * 按天间隔时裂缝变化速率约 0.004 mm/h，低于 0.10 mm/h 的速率阈值，
 * 演示看到的是纯粹的绝对值分级（黄 → 橙 → 红），不会被速率规则提前升级。
 *
 * 由脚本写入的记录采样时间早于当前时间，会按方案标注为「历史补录」，
 * 不会伪装成实时预警；每条记录的备注写明来自演示脚本。
 */
import type { MetricValues } from '@/types/domain'
import type { DataState } from '@/types/rules'

export interface DemoSample {
  /** 阶段名称，用于备注与结果核对 */
  label: string
  /** 相对基准时刻的分钟偏移 */
  offsetMinutes: number
  values: MetricValues
  /** 标准表给出的预期结果文案 */
  expect: string
  /**
   * 标准表给出的确定数据状态。
   * 只在前四行（绝对值分级）填写：恢复过程按"连续 3 条"判定，
   * 出现的行次取决于该测点已有记录，逐条比对没有意义，因此留空。
   */
  expectState?: DataState
}

const DAY = 1440

/** 裂缝宽度变化：基准 0.50 mm 的主展示闭环。 */
export const CRACK_SAMPLES: DemoSample[] = [
  { label: '第一天 09:00', offsetMinutes: 0, values: { width: 0.52 }, expect: '正常', expectState: 'normal' },
  { label: '第二天 09:00', offsetMinutes: 1 * DAY, values: { width: 0.62 }, expect: '黄色预警', expectState: 'yellow' },
  { label: '第三天 09:00', offsetMinutes: 2 * DAY, values: { width: 0.73 }, expect: '橙色预警', expectState: 'orange' },
  { label: '第四天 09:00', offsetMinutes: 3 * DAY, values: { width: 0.82 }, expect: '红色预警', expectState: 'red' },
  { label: '维修后第 1 条', offsetMinutes: 10 * DAY, values: { width: 0.54 }, expect: '恢复待确认' },
  { label: '维修后第 2 条', offsetMinutes: 10 * DAY + 5, values: { width: 0.53 }, expect: '（标准表未列）' },
  { label: '维修后第 3 条', offsetMinutes: 10 * DAY + 10, values: { width: 0.53 }, expect: '恢复待确认' },
  { label: '复查记录', offsetMinutes: 11 * DAY, values: { width: 0.53 }, expect: '可以申请关闭' },
]

/**
 * 基准时刻：回溯 12 天后取当天 09:00。
 * 这样最后一条落在昨天 09:00，脚本写入的数据永远全部是过去时间，
 * 不会因为演示时段不同而触发"采样时间晚于当前时间"的校验。
 */
export function demoScriptBase(now: Date = new Date()): Date {
  const base = new Date(now.getTime() - 12 * DAY * 60_000)
  base.setHours(9, 0, 0, 0)
  return base
}

export function demoSampleTime(sample: DemoSample, base: Date): string {
  return new Date(base.getTime() + sample.offsetMinutes * 60_000).toISOString()
}

export const DEMO_SCRIPT_LABEL = '演示脚本一键导入'
