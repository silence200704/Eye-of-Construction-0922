/**
 * 点位判定入口：把"按采样时间取基准 → 按采样时间取规则版本 → 判定"收敛为唯一一条路径。
 *
 * 录入弹窗的实时试算、预警标准页的单条试算、演示脚本核对、保存记录后的判定都调用本函数，
 * 避免出现"页面显示橙色、保存后却是黄色"这类口径不一致。
 */
import type { Baseline, MetricValues, MonitorRecord, QualityFlag } from '@/types/domain'
import type { MonitoringRule } from '@/types/rules'
import type { RuleAssessment } from '@/types/rules'
import { assessRecord, previewRecord, snapshotOf, type AssessmentSnapshot } from '@/core/rules'
import { useArchiveStore } from './archive'
import { useRecordsStore } from './records'

export interface AssessRequest {
  pointId: string
  values: MetricValues
  /** 采样时间：基准与规则版本都按它选取 */
  sampleTime: string
  sampleWindow: string
  quality: QualityFlag
  deviceId: string | null
  /** 修订时排除自身，避免把自己算进历史 */
  excludeRecordId?: string | null
  /**
   * 追加到历史序列末尾的记录。
   * 演示脚本核对用它还原"前几条"的场景，让持续异常与恢复待确认可以成立；
   * 不传时只用数据库里已有的记录。
   */
  extraHistory?: MonitorRecord[]
  /**
   * 只把 extraHistory 当作历史，不读数据库里的记录。
   * 演示脚本核对属于推演，混入现场真实记录会让结果不可复现。
   */
  sequenceOnly?: boolean
}

export interface AssessOutcome {
  rule: MonitoringRule
  snapshot: AssessmentSnapshot
  assessment: RuleAssessment
  /** 按采样时间取到的生效基准 */
  baseline: Baseline | undefined
  history: MonitorRecord[]
}

/** 返回 null 表示该点位没有适用的启用规则（例如人工检查点）。 */
export function assessPoint(input: AssessRequest): AssessOutcome | null {
  const archive = useArchiveStore()
  const records = useRecordsStore()
  const point = archive.pointById(input.pointId)
  if (point === undefined) return null
  const rule = archive.ruleFor(point.id, input.sampleTime)
  if (rule === undefined) return null

  const baseline = archive.baselineAt(point.id, input.sampleTime)
  const baselineValues = baseline?.values ?? null
  /*
   * 历史序列同样按采样时间截断：只看采样时间不晚于当前这条的记录。
   * 否则补录一条旧数据时，会被之后录入的记录影响 —— 持续异常与恢复判定都会误判。
   */
  const stored =
    input.sequenceOnly === true
      ? []
      : records
          .ofPoint(point.id)
          .filter((row) => row.id !== input.excludeRecordId && row.sampleTime <= input.sampleTime)
  const history = [...stored, ...(input.extraHistory ?? [])]
    .filter((row) => row.sampleTime <= input.sampleTime)
    .sort((a, b) => a.sampleTime.localeCompare(b.sampleTime))
  const current = previewRecord({
    pointId: point.id,
    metric: point.metric,
    values: input.values,
    baselineValues,
    unit: rule.unit,
    sampleTime: input.sampleTime,
    sampleWindow: input.sampleWindow,
  })
  const device =
    input.deviceId === null
      ? archive.devicesOfPoint(point.id)[0]
      : archive.deviceById(input.deviceId)

  return {
    rule,
    snapshot: snapshotOf(rule),
    baseline,
    history,
    assessment: assessRecord({
      rule,
      point,
      values: input.values,
      baselineValues,
      quality: input.quality,
      device,
      history: [...history, current],
      at: input.sampleTime,
    }),
  }
}
