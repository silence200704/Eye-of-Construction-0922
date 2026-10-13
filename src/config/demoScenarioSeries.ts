/**
 * 模块演示场景的补充数据序列。
 *
 * 裂缝主链（0.52 → 0.62 → 0.73 → 0.82 与三条复测）是权威数据，定义在 `demoScript.ts`，这里不重复造；
 * 本文件只补其他测点，并单独给出振动事件的序列。
 *
 * 填值口径（已核对 `src/core/assess/engine.ts` 与 `src/core/event/plan.ts`）：
 * - 状态由**单条**判定的量级直接得出，持续异常只把等级往上抬，不会下压 —— 单条越限即生成事件。
 * - 恢复态在**没有未关闭事件**时返回 `none`，不会凭空建单，所以补低值序列是安全的。
 * - 倾角黄阈 0.10°、振动黄阈 0.05 m/s²、温湿度 5~35℃ 与 80%RH；倾角与振动**没有**配速率规则。
 *
 * 时间锚点有两种，别混：
 * - `offsetMinutes` 相对**基准日**（`demoScriptBase()` = 运行日 −12 天 09:00），与主链同一根时间轴；
 * - `dayOffset` + `atMinute` 相对**当天零点**，用于必须落在"最近"的序列（见下）。
 */
import type { MetricValues } from '@/types/domain'
import type { DataState } from '@/types/rules'
import { P_TH, P_TILT, P_VIB } from '@/db/seedFactories'

export interface ScenarioSample {
  /** 阶段名称，写入记录备注，便于与手工数据区分 */
  label: string
  /** 相对基准日的分钟偏移（与主链同一根时间轴） */
  offsetMinutes: number
  values: MetricValues
  /** 标准表给出的预期结果文案 */
  expect: string
  /** 预期数据状态，用于载入后自校验；不填表示该行按序列判定、不逐条比对 */
  expectState?: DataState
}

export interface ScenarioSeries {
  pointId: string
  deviceId: string
  unit: string
  window: string
  samples: ScenarioSample[]
}

const DAY = 1440
const HOUR = 60

/** 倾角：每两天一条，0.04 → 0.06 → 0.08，逼近 0.10° 黄阈值但未越限（不生成事件）。 */
export const TILT_SCENARIO: ScenarioSeries = {
  pointId: P_TILT,
  deviceId: 'dev_b03_f2_tilt01',
  unit: '°',
  window: '',
  samples: [
    { label: '倾角第 1 条', offsetMinutes: 3 * DAY + 9 * HOUR, values: { angleX: 0.04, angleY: -0.02 }, expect: '正常', expectState: 'normal' },
    { label: '倾角第 2 条', offsetMinutes: 5 * DAY + 9 * HOUR, values: { angleX: 0.06, angleY: -0.02 }, expect: '正常（逼近黄阈值）', expectState: 'normal' },
    { label: '倾角第 3 条', offsetMinutes: 7 * DAY + 9 * HOUR, values: { angleX: 0.08, angleY: -0.03 }, expect: '正常（未越限）', expectState: 'normal' },
  ],
}

/** 温湿度：每两条间隔两天，全部落在 5~35℃ 与 80%RH 以内，只作环境辅助（不生成事件）。 */
export const ENV_SCENARIO: ScenarioSeries = {
  pointId: P_TH,
  deviceId: 'dev_b03_f2_th01',
  unit: '℃ / %RH',
  window: '',
  samples: [
    { label: '温湿度第 1 条', offsetMinutes: 7 * DAY + 14 * HOUR + 5, values: { temperature: 24.6, humidity: 58.2 }, expect: '正常', expectState: 'normal' },
    { label: '温湿度第 2 条', offsetMinutes: 9 * DAY + 14 * HOUR + 5, values: { temperature: 26.1, humidity: 61.5 }, expect: '正常', expectState: 'normal' },
    { label: '温湿度第 3 条', offsetMinutes: 11 * DAY + 14 * HOUR + 5, values: { temperature: 27.4, humidity: 63.8 }, expect: '正常', expectState: 'normal' },
  ],
}

/** 趋势场景补入的序列（振动不在这里，它随振动预警事件场景一起写入，见下方说明）。 */
export const TREND_SCENARIOS: ScenarioSeries[] = [TILT_SCENARIO, ENV_SCENARIO]

/**
 * 振动事件序列：演示**绝对判定 + 持续异常**与**第二种关闭依据（现场核查无需维修）**。
 *
 * 与裂缝主链互补 —— 裂缝走"相对基准的绝对值分级 + 速率规则 + 工单验收通过后关闭"，
 * 振动走"绝对阈值 + 连续 3 条越限升橙 + 现场核查结论关闭"。
 *
 * **为什么锚在"最近两天"而不是基准日**：示例校区种子自己带两条固定日期的振动记录
 * （0.042 与 0.061 m/s²），而持续异常判定看的是**按采样时间排序的末尾几条**。
 * 若本序列写在种子那两条之前，末尾就不是这三条越限记录，升橙与恢复都不会命中。
 * 把整段放在"最近两天"可保证它落在种子日期之后。
 *
 * 越限三条间隔 5 分钟、跨度 10 分钟，正好命中持续异常条件（3 条 / ≥10 分钟 / 相邻 ≤5 分钟）。
 *
 * **开头那条"振动基线第 1 条"不是摆设**：种子里 09-18 那条 0.061 m/s² 也越限，
 * 若不先用一条低于阈值的记录把连续段断开，持续异常会把种子那条和本段连成一段，
 * 而它们之间隔了三天 —— 相邻间隔超过 5 分钟，判定会返回 miss，等级升不到橙色。
 */
export const VIB_EVENT_SCENARIO: {
  pointId: string
  deviceId: string
  unit: string
  window: string
  /** 整段序列锚在"运行日 −2 天"的零点，下列偏移是该日内的分钟数（可为负，表示前一天） */
  samples: ScenarioSample[]
} = {
  pointId: P_VIB,
  deviceId: 'dev_b03_f2_vib01',
  unit: 'm/s²',
  window: '1 s',
  samples: [
    {
      label: '振动基线第 1 条',
      offsetMinutes: -9 * HOUR,
      values: { accelRms: 0.03, accelPeak: 0.1 },
      expect: '正常（用于断开上一条越限记录的连续段）',
      expectState: 'normal',
    },
    { label: '振动越限第 1 条', offsetMinutes: 16 * HOUR, values: { accelRms: 0.052, accelPeak: 0.19 }, expect: '黄色（单条越限即建单）', expectState: 'yellow' },
    { label: '振动越限第 2 条', offsetMinutes: 16 * HOUR + 5, values: { accelRms: 0.058, accelPeak: 0.21 }, expect: '黄色（越限第 2 条）', expectState: 'yellow' },
    { label: '振动越限第 3 条', offsetMinutes: 16 * HOUR + 10, values: { accelRms: 0.061, accelPeak: 0.22 }, expect: '橙色（持续异常：3 条 / 10 分钟）', expectState: 'orange' },
    { label: '振动恢复第 1 条', offsetMinutes: 17 * HOUR, values: { accelRms: 0.038, accelPeak: 0.13 }, expect: '正常（低于黄阈值 0.8 倍）', expectState: 'normal' },
    { label: '振动恢复第 2 条', offsetMinutes: 17 * HOUR + 5, values: { accelRms: 0.036, accelPeak: 0.12 }, expect: '正常', expectState: 'normal' },
    { label: '振动恢复第 3 条', offsetMinutes: 17 * HOUR + 10, values: { accelRms: 0.034, accelPeak: 0.11 }, expect: '恢复待确认（可走现场核查无需维修关闭）', expectState: 'recovering' },
  ],
}

/** 振动事件场景的现场核查结论：关闭时需要，必须写满 10 个字才被接受。 */
export const VIB_NO_REPAIR_NOTE = '现场核查楼板与支承未见异常，振动来自临时装修作业，无需维修'
export const VIB_CLOSE_BASIS = '连续三条复测 0.034~0.038 m/s²，均低于黄阈值 0.8 倍'

/**
 * 温湿度环境提醒序列：给预警提醒补充**另一类**通知，并演示"环境异常不生成结构红色预警"。
 *
 * 温度 >35℃ 或湿度 >80%RH 生成环境提醒；**连续 3 条越限**升为环境复核任务。
 * 因此这里写 3 条连续越限，拿到的是一条橙色环境提醒，而不是结构预警。
 * 与振动同理锚在"最近一天"，保证它落在种子里那两条固定日期的温湿度记录之后 ——
 * 环境规则的"连续 3 条"同样看按时间排序的末尾几条。
 */
export const ENV_ALARM_SCENARIO: {
  pointId: string
  deviceId: string
  unit: string
  window: string
  samples: ScenarioSample[]
} = {
  pointId: P_TH,
  deviceId: 'dev_b03_f2_th01',
  unit: '℃ / %RH',
  window: '',
  samples: [
    { label: '环境越限第 1 条', offsetMinutes: 16 * HOUR, values: { temperature: 36.2, humidity: 82.1 }, expect: '环境提醒（黄色）', expectState: 'yellow' },
    { label: '环境越限第 2 条', offsetMinutes: 16 * HOUR + 5, values: { temperature: 36.8, humidity: 84.4 }, expect: '环境提醒（黄色）', expectState: 'yellow' },
    { label: '环境越限第 3 条', offsetMinutes: 16 * HOUR + 10, values: { temperature: 37.1, humidity: 86.2 }, expect: '环境复核任务（连续 3 条越限转橙）', expectState: 'orange' },
  ],
}
