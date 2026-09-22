/**
 * 监测记录：单条录入、历史查询与修订留痕。
 * 修改保存原值，不静默覆盖；记录保存录入当时的基准快照，保证变化量可解释。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { MetricValues, MonitorRecord, QualityFlag, RecordSource } from '@/types/domain'
import { BACKFILL_THRESHOLD_MINUTES } from '@/types/catalog'
import { dayKey, isBackfill, nowIso } from '@/core/time'
import { nextRecordNo, uid } from '@/core/id'
import { db } from '@/db/database'
import { putRecord } from '@/db/repo'
import { assessPoint } from './assessment'
import { applyAssessment, applyRevision, type ApplyResult } from './writes/eventWrites'
import { useArchiveStore } from './archive'
import { useSessionStore } from './session'
import { useAlertStore } from './alerts'
import { useEventsStore } from './events'
import { shouldPresentManualAlert } from '@/core/event/alertPrompt'

export interface RecordDraft {
  pointId: string
  deviceId: string | null
  values: MetricValues
  unit: string
  sampleTime: string
  sampleWindow: string
  source: RecordSource
  quality: QualityFlag
  qualityNote: string
  note: string
}

export const useRecordsStore = defineStore('records', () => {
  const records = ref<MonitorRecord[]>([])
  const loaded = ref(false)
  /** 最近一次保存后对预警事件做了什么，供录入弹窗提示 */
  const lastEventMessage = ref('')
  /** 最近一次保存的结构化事件结果，供批量导入做一条汇总提醒。 */
  const lastEventOutcome = ref<ApplyResult>({ action: 'none', eventId: '', message: '' })

  async function load(): Promise<void> {
    records.value = await db.records.toArray()
    loaded.value = true
  }

  async function reload(): Promise<void> {
    records.value = await db.records.toArray()
  }

  const sorted = computed(() => [...records.value].sort((a, b) => b.sampleTime.localeCompare(a.sampleTime)))

  const total = computed(() => records.value.length)

  const suspectCount = computed(() => records.value.filter((row) => row.quality !== 'valid').length)

  const revisedCount = computed(() => records.value.filter((row) => row.revision > 0).length)

  function ofPoint(pointId: string): MonitorRecord[] {
    return records.value
      .filter((row) => row.pointId === pointId)
      .sort((a, b) => a.sampleTime.localeCompare(b.sampleTime))
  }

  function countOfPoint(pointId: string): number {
    return records.value.filter((row) => row.pointId === pointId).length
  }

  function recent(limit: number): MonitorRecord[] {
    return sorted.value.slice(0, limit)
  }

  function latestOfPoint(pointId: string): MonitorRecord | undefined {
    const list = ofPoint(pointId)
    return list.length === 0 ? undefined : list[list.length - 1]
  }

  async function addRecord(draft: RecordDraft): Promise<MonitorRecord> {
    const archive = useArchiveStore()
    const session = useSessionStore()
    // 按采样时间取生效基准：未来才生效的基准不参与本次录入
    const baseline = archive.baselineAt(draft.pointId, draft.sampleTime)
    const at = nowIso()
    const row: MonitorRecord = {
      id: uid('rec'),
      recordNo: nextRecordNo(dayKey(draft.sampleTime), records.value),
      pointId: draft.pointId,
      deviceId: draft.deviceId,
      metric: archive.pointById(draft.pointId)?.metric ?? 'crack_width',
      values: draft.values,
      unit: draft.unit,
      sampleTime: draft.sampleTime,
      sampleWindow: draft.sampleWindow,
      enteredAt: at,
      enteredBy: session.name,
      enteredByRole: session.roleLabel,
      source: draft.source,
      quality: draft.quality,
      qualityNote: draft.qualityNote,
      note: draft.note,
      isBackfill: isBackfill(draft.sampleTime, at, BACKFILL_THRESHOLD_MINUTES),
      baselineVersion: baseline?.version ?? null,
      baselineValues: baseline?.values ?? null,
      revision: 0,
      revisions: [],
      createdAt: at,
    }
    await putRecord(row)
    await archive.log(
      'create',
      'record',
      row.id,
      `${row.recordNo} ${archive.pointLabel(row.pointId)}`,
      `录入监测记录 ${row.recordNo}`,
      draft.note,
    )
    await reload()
    const applied = await applyToEvents(row, null)
    lastEventOutcome.value = applied
    lastEventMessage.value = applied.message
    presentManualAlert(row, applied)
    return row
  }

  /**
   * 新增记录后把判定结果落到事件：越限则生成或升级事件，恢复则把未关闭事件标为恢复待确认。
   */
  async function applyToEvents(row: MonitorRecord, previousRecordId: string | null): Promise<ApplyResult> {
    const outcome = assessPoint({
      pointId: row.pointId,
      values: row.values,
      sampleTime: row.sampleTime,
      sampleWindow: row.sampleWindow,
      quality: row.quality,
      deviceId: row.deviceId,
      excludeRecordId: previousRecordId ?? row.id,
    })
    if (outcome === null) return { action: 'none', eventId: '', message: '该点位没有适用的启用规则，未生成预警事件' }
    const result = await applyAssessment({ record: row, assessment: outcome.assessment, snapshot: outcome.snapshot })
    return result.message === '' ? { ...result, message: '判定结果不构成越限，未生成事件' } : result
  }

  /** 只对当下手工录入或设备上报的新建 / 升级事件提示；历史补录与演示脚本不打断操作者。 */
  function presentManualAlert(row: MonitorRecord, outcome: ApplyResult): void {
    if (!shouldPresentManualAlert(row) || outcome.eventId === '') return
    const event = useEventsStore().byId(outcome.eventId)
    if (event === undefined) return
    useAlertStore().enqueueEvent({ event, action: outcome.action, pointLabel: useArchiveStore().pointLabel(row.pointId) })
  }

  /** 修订保留原值：修订前的数值、单位、采样时间与质量标记全部进入 revisions。 */
  async function reviseRecord(id: string, draft: RecordDraft, reason: string): Promise<void> {
    const archive = useArchiveStore()
    const session = useSessionStore()
    const existing = records.value.find((row) => row.id === id)
    if (existing === undefined) return
    const at = nowIso()
    // 采样时间可能被改到别的基准生效期内，基准快照必须按新的采样时间重算
    const baseline = archive.baselineAt(existing.pointId, draft.sampleTime)
    const row: MonitorRecord = {
      ...existing,
      values: draft.values,
      unit: draft.unit,
      sampleTime: draft.sampleTime,
      sampleWindow: draft.sampleWindow,
      source: draft.source,
      quality: draft.quality,
      qualityNote: draft.qualityNote,
      note: draft.note,
      isBackfill: isBackfill(draft.sampleTime, at, BACKFILL_THRESHOLD_MINUTES),
      baselineVersion: baseline?.version ?? null,
      baselineValues: baseline?.values ?? null,
      revisions: [
        ...existing.revisions,
        {
          at,
          by: session.name,
          role: session.roleLabel,
          reason,
          before: {
            values: existing.values,
            unit: existing.unit,
            sampleTime: existing.sampleTime,
            quality: existing.quality,
            sampleWindow: existing.sampleWindow,
            baselineVersion: existing.baselineVersion,
            baselineValues: existing.baselineValues,
          },
        },
      ],
      revision: existing.revision + 1,
    }
    await putRecord(row)
    await archive.log(
      'revise',
      'record',
      row.id,
      `${row.recordNo} ${archive.pointLabel(row.pointId)}`,
      `修订监测记录 ${row.recordNo}（第 ${row.revision} 次）${
        baseline?.version === existing.baselineVersion ? '' : `；基准快照由 v${existing.baselineVersion ?? '无'} 改为 v${baseline?.version ?? '无'}`
      }`,
      reason,
    )
    await reload()
    const applied = await applyRevisionToEvents(row, reason)
    lastEventOutcome.value = applied
    lastEventMessage.value = applied.message
  }

  /** 修订后调整事件：旧证据被替代或撤销，等级按活跃证据重新汇总。 */
  async function applyRevisionToEvents(row: MonitorRecord, reason: string): Promise<ApplyResult> {
    const outcome = assessPoint({
      pointId: row.pointId,
      values: row.values,
      sampleTime: row.sampleTime,
      sampleWindow: row.sampleWindow,
      quality: row.quality,
      deviceId: row.deviceId,
      excludeRecordId: row.id,
    })
    if (outcome === null) return { action: 'none', eventId: '', message: '该点位没有适用的启用规则，未生成预警事件' }
    const result = await applyRevision({
      record: row,
      assessment: outcome.assessment,
      snapshot: outcome.snapshot,
      reason,
    })
    return result.message === '' ? { ...result, message: '修订后的判定不构成越限，未变更事件' } : result
  }

  return {
    records,
    loaded,
    lastEventMessage,
    lastEventOutcome,
    sorted,
    total,
    suspectCount,
    revisedCount,
    load,
    reload,
    ofPoint,
    countOfPoint,
    recent,
    latestOfPoint,
    addRecord,
    reviseRecord,
  }
})
