import { CRACK_SAMPLES, demoSampleTime } from '@/config/demoScript'
import { useRecordsStore } from '@/stores/records'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import type { MetricValues, QualityFlag } from '@/types/domain'
import { nowIso } from '@/core/time'
import { DEMO_LIVE_SAMPLE_NOTE } from '@/types/catalog'
import { COVERAGE_NOTE, extraDeviceId, NORMAL_TH, QUALITY_TILT, READY_CRACK, STALE_VIB } from './archive'
import { presentLoadedAlerts } from '../support'

/** 不覆盖采样时刻；同槽存在非本场景记录时明确失败，不把它纳入场景成功数。 */
export async function addSample(input: { pointId: string; values: MetricValues; unit: string; sampleTime: string; quality?: QualityFlag; tag: string }): Promise<number> {
  const store = useRecordsStore()
  const existing = store.records.find((row) => row.pointId === input.pointId && row.sampleTime === input.sampleTime)
  if (existing !== undefined) {
    if (!existing.note.startsWith(COVERAGE_NOTE)) throw new Error('采样时刻与非本场景记录冲突，未改写')
    return 0
  }
  await store.addRecord({
    pointId: input.pointId, deviceId: extraDeviceId(input.pointId), values: input.values,
    unit: input.unit, sampleTime: input.sampleTime, sampleWindow: input.unit === 'm/s²' ? '1 s' : '',
    source: 'device', quality: input.quality ?? 'valid', qualityNote: input.quality === undefined ? '' : `${COVERAGE_NOTE} ${input.quality === 'suspect' ? '存疑，待复核' : '无效，不参与判定'}`,
    note: `${COVERAGE_NOTE} ${input.tag}`,
  })
  return 1
}

export async function prepareQualitySamples(): Promise<number> {
  const store = useRecordsStore()
  await store.reload()
  const at = Date.parse(nowIso())
  const iso = (minutes: number) => new Date(at - minutes * 60_000).toISOString()
  let created = 0
  for (const [id, values, unit] of [
    [NORMAL_TH, { temperature: 25.2, humidity: 58.6 }, '℃ / %RH'],
    [QUALITY_TILT, { angleX: 0.05, angleY: -0.02 }, '°'],
  ] as const) {
    const rows = store.ofPoint(id)
    const latest = rows[rows.length - 1]
    if (latest !== undefined && at - Date.parse(latest.sampleTime) < 30 * 60_000) continue
    for (const minutes of [12, 8, 4, 0]) created += await addSample({ pointId: id, values, unit, sampleTime: iso(minutes), tag: DEMO_LIVE_SAMPLE_NOTE })
  }
  if (!store.ofPoint(QUALITY_TILT).some((row) => row.quality !== 'valid')) {
    created += await addSample({ pointId: QUALITY_TILT, values: { angleX: 5, angleY: 4 }, unit: '°', sampleTime: iso(125), quality: 'suspect', tag: '质量对照：存疑异常大值' })
    created += await addSample({ pointId: QUALITY_TILT, values: { angleX: 8, angleY: 7 }, unit: '°', sampleTime: iso(120), quality: 'invalid', tag: '质量对照：无效异常大值' })
  }
  if (store.ofPoint(STALE_VIB).length === 0) {
    for (const minutes of [180, 150, 120]) created += await addSample({ pointId: STALE_VIB, values: { accelRms: 0.02, accelPeak: 0.06 }, unit: 'm/s²', sampleTime: iso(minutes), tag: '过期数据案例：不用于证明设备离线' })
  }
  return created
}

/** 独立测点生成未处置红色事件；已有人处理过则保留其进度，绝不重置状态。 */
export async function preparePendingRed(): Promise<string> {
  const events = useEventsStore()
  const records = useRecordsStore()
  await Promise.all([events.reload(), records.reload()])
  const existing = events.events.find((row) => row.pointId === READY_CRACK)
  if (existing !== undefined) {
    if (!records.ofPoint(READY_CRACK).every((row) => row.note.startsWith(COVERAGE_NOTE))) throw new Error('待处理测点已有其他数据，不追加演示预警')
    if (existing.status === 'pending') presentLoadedAlerts([existing])
    return existing.id
  }
  if (records.ofPoint(READY_CRACK).length > 0) throw new Error('待处理案例有不完整记录，请先核对，不自动覆盖')
  const rule = useArchiveStore().ruleFor(READY_CRACK, nowIso())
  if (rule === undefined) throw new Error('待处理裂缝没有适用规则')
  // 逐日爬升至本次载入前一分钟，最新值可用于当前演示；不是加速跳过原速率阈值。
  const base = new Date(Date.now() - 3 * 86_400_000 - 60_000)
  for (const sample of CRACK_SAMPLES.slice(0, 4)) await addSample({ pointId: READY_CRACK, values: sample.values, unit: 'mm', sampleTime: demoSampleTime(sample, base), tag: `红色待处理：${sample.label}` })
  await events.reload()
  const event = events.openEventOf(READY_CRACK, rule.ruleId)
  if (event?.level !== 'red' || event.status !== 'pending') throw new Error('规则未形成待确认红色事件')
  presentLoadedAlerts([event])
  return event.id
}
