/** 现场处置入口：只把红色事件准备到待确认，后续由演示者现场操作。 */
import { CRACK_SAMPLES, demoSampleTime } from '@/config/demoScript'
import { nowIso } from '@/core/time'
import { useArchiveStore } from '@/stores/archive'
import { useEventsStore } from '@/stores/events'
import { useIssueStore } from '@/stores/inspection/issues'
import { useRecordsStore } from '@/stores/records'
import { resolveDemoBase } from '@/stores/writes/demoWrites'
import { alertNote, logScenario, makeResult, presentLoadedAlerts, type DemoScenarioResult } from './support'

const KEY = 'liveResponse' as const
const POINT_ID = 'pnt_b03_f2_crack01'
const NOTE = '现场处置演示'
const SAMPLES = CRACK_SAMPLES.slice(0, 4)

export async function loadLiveResponseScenario(): Promise<DemoScenarioResult> {
  const archive = useArchiveStore()
  const records = useRecordsStore()
  const events = useEventsStore()
  const issues = useIssueStore()
  await Promise.all([records.reload(), events.reload(), issues.reload()])

  const point = archive.pointById(POINT_ID)
  if (point?.status !== 'active') return makeResult(KEY, false, '裂缝测点未在册；请先重新载入示例校区')
  const rule = archive.ruleFor(POINT_ID, nowIso())
  if (rule === undefined) return makeResult(KEY, false, '裂缝测点没有适用规则；请先重新载入示例校区')
  const base = resolveDemoBase(rule.effectiveFrom, POINT_ID)
  const times = SAMPLES.map((sample) => demoSampleTime(sample, base))
  const existing = times.map((time) => records.records.find((row) => row.pointId === POINT_ID && row.sampleTime === time))
  if (existing.some((row) => row !== undefined && !row.note.startsWith(NOTE))) {
    return makeResult(KEY, false, '采样时刻与已有非本场景记录冲突；未改写数据，请重新载入示例校区后重试')
  }
  const current = events.events.find((row) => row.pointId === POINT_ID && row.ruleId === rule.ruleId)
  if (current !== undefined && (current.status !== 'pending' || existing.every((row) => row === undefined))) {
    return makeResult(KEY, false, '该测点已有处置中的预警；请重新载入示例校区后演示完整现场流程')
  }
  if (current !== undefined && issues.issues.some((row) => row.eventId === current.id)) {
    return makeResult(KEY, false, '该预警已转问题处理；请继续处置，或重新载入示例校区后重新演示')
  }

  let created = 0
  for (const [index, sample] of SAMPLES.entries()) {
    if (existing[index] !== undefined) continue
    await records.addRecord({
      pointId: POINT_ID,
      deviceId: null,
      values: sample.values,
      unit: 'mm',
      sampleTime: times[index] ?? '',
      sampleWindow: '',
      source: 'manual',
      quality: 'valid',
      qualityNote: '',
      note: `${NOTE}：${sample.label}（历史补录）`,
    })
    created += 1
  }

  await events.reload()
  const event = events.openEventOf(POINT_ID, rule.ruleId)
  if (event?.level !== 'red' || event.status !== 'pending') {
    return makeResult(KEY, false, '未形成待确认的红色事件，请检查示例规则与同测点已有记录', { created, skipped: SAMPLES.length - created })
  }
  const shown = presentLoadedAlerts([event])
  const message = `现场处置已准备：${event.eventNo} 红色待确认；新增 ${created} 条、已有 ${SAMPLES.length - created} 条；` +
    `证据 ${event.evidences.length} 条、升级 ${event.upgrades.length} 次、通知 ${events.notificationsOf(event.id).length} 条；` +
    `尚未转问题、派工或验收；${alertNote(shown)}`
  await logScenario(KEY, '红色预警现场处置', message)
  return makeResult(KEY, true, message, {
    created,
    skipped: SAMPLES.length - created,
    anchors: [event.eventNo],
    anchorRefs: [{ kind: 'event', id: event.id }],
    focus: { path: '/alarms', query: { event: event.id } },
  })
}
