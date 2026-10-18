/**
 * 一键演示脚本的执行。
 *
 * 刻意不绕过正常录入路径：每条数据都走 records.addRecord，
 * 因此校验、基准快照、规则判定、事件生成与通知全部与手工录入完全一致 ——
 * 演示看到的就是真实流程，不是预置的结果。
 */
import { nowIso } from '@/core/time'
import { putNotification } from '@/db/repo'
import type { MonitorRecord } from '@/types/domain'
import type { DataState } from '@/types/rules'
import { stateLabel } from '@/core/rules'
import { assessPoint } from '../assessment'
import { useArchiveStore } from '../archive'
import { useEventsStore } from '../events'
import { useRecordsStore } from '../records'
import { CRACK_SAMPLES, DEMO_SCRIPT_LABEL, demoScriptBase, demoSampleTime } from '@/config/demoScript'
import { D_CRACK } from '@/db/seedFactories'
import { requireLocalDemo } from '@/api/backend/runtime'

export interface DemoRunResult {
  created: number
  skipped: number
  eventNo: string
  evidences: number
  upgrades: number
  notifications: number
  /** 按规则应当得到的结果与实算结果逐条对照 */
  rows: { label: string; expect: string; expectState: DataState | null; actual: string; actualState: DataState | null }[]
}

/**
 * 推导演示基准时刻：既要晚于规则生效时间，又要让整段脚本（含最后一条）落在过去。
 * 两个条件无法同时满足时直接报错，不静默把数据写成"规则未生效"或"未来时间"。
 *
 * 导出给演示场景用：它要按同一基准复算采样时刻，才能分辨"已存在的是上次载入还是手工录入"。
 */
export function resolveDemoBase(effectiveFrom: string, pointId: string): Date {
  const preferred = demoScriptBase()
  const ruleStart = effectiveFrom === '' ? 0 : new Date(effectiveFrom).getTime()
  const span = 11 * 1440 * 60_000
  const base = new Date(Math.max(preferred.getTime(), ruleStart + 60 * 60_000))
  if (base.getTime() + span > Date.now()) {
    const archive = useArchiveStore()
    const rule = archive.ruleFor(pointId, nowIso())
    throw new Error(
      `演示脚本需要 12 天跨度，但规则 ${rule?.code ?? ''} 的生效时间是 ${rule?.effectiveFrom.slice(0, 10) ?? '未知'}，` +
        '窗口不够。请把规则生效时间改到更早，或到系统设置清空本机数据后用唯一入口重新载入全链演示数据。',
    )
  }
  return base
}

/** 找到演示脚本作用的结构测点：取第一个有适用裂缝规则的测点。 */
function crackPointId(): string {
  const archive = useArchiveStore()
  const at = nowIso()
  const point = archive.activePoints.find((row) => archive.ruleFor(row.id, at)?.metric === 'crack_width')
  return point?.id ?? ''
}

export async function runDemoScript(): Promise<DemoRunResult> {
  requireLocalDemo('一键演示脚本')
  const archive = useArchiveStore()
  const events = useEventsStore()
  const records = useRecordsStore()

  const pointId = crackPointId()
  if (pointId === '') throw new Error('示例数据里没有裂缝测点，无法执行演示脚本')

  // 基准时刻必须落在规则生效期内，且整段脚本都在过去
  const rule = archive.ruleFor(pointId, nowIso())
  const base = resolveDemoBase(rule?.effectiveFrom ?? '', pointId)
  const rows: DemoRunResult['rows'] = []
  let created = 0
  let skipped = 0

  for (const sample of CRACK_SAMPLES) {
    const sampleTime = demoSampleTime(sample, base)
    const existed = records.records.some((row) => row.pointId === pointId && row.sampleTime === sampleTime)
    if (existed) {
      skipped += 1
      rows.push({ label: sample.label, expect: sample.expect, expectState: sample.expectState ?? null, actual: '已存在，跳过', actualState: null })
      continue
    }
    await records.addRecord({
      pointId,
      deviceId: D_CRACK,
      values: sample.values,
      unit: 'mm',
      sampleTime,
      sampleWindow: '',
      source: 'device',
      quality: 'valid',
      qualityNote: '',
      note: `${DEMO_SCRIPT_LABEL}：${sample.label}`,
    })
    created += 1
    rows.push({
      label: sample.label,
      expect: sample.expect,
      expectState: sample.expectState ?? null,
      actual: records.lastEventMessage,
      actualState: null,
    })
  }

  // 逐条核对实算结果
  const actualRows = await verifySamples(pointId, base, rows)

  const event = rule === undefined ? undefined : events.openEventOf(pointId, rule.ruleId)
  await archive.log(
    'import',
    'system',
    'demo-script',
    '演示脚本',
    `一键生成演示数据：新增 ${created} 条记录，跳过 ${skipped} 条`,
    '用于答辩演示；来源为预设传感器模拟采样，采样时间早于当前时间，按历史补录标记；未接入真实设备',
  )

  return {
    created,
    skipped,
    eventNo: event?.eventNo ?? '',
    evidences: event?.evidences.length ?? 0,
    upgrades: event?.upgrades.length ?? 0,
    notifications: event === undefined ? 0 : events.notificationsOf(event.id).length,
    rows: actualRows,
  }
}

/** 用同一判定入口复算每条样本，把实算结果与标准预期并排返回。 */
async function verifySamples(
  pointId: string,
  base: Date,
  rows: DemoRunResult['rows'],
): Promise<DemoRunResult['rows']> {
  const records = useRecordsStore()
  const out: DemoRunResult['rows'] = []
  const byTime = new Map<string, MonitorRecord>(
    records.ofPoint(pointId).map((row) => [row.sampleTime, row]),
  )
  for (const [index, sample] of CRACK_SAMPLES.entries()) {
    const record = byTime.get(demoSampleTime(sample, base))
    if (record === undefined) {
      out.push(rows[index] ?? { label: sample.label, expect: sample.expect, actual: '未写入' })
      continue
    }
    const outcome = assessPoint({
      pointId,
      values: record.values,
      sampleTime: record.sampleTime,
      sampleWindow: record.sampleWindow,
      quality: record.quality,
      deviceId: record.deviceId,
      excludeRecordId: record.id,
    })
    out.push({
      label: sample.label,
      expect: sample.expect,
      expectState: sample.expectState ?? null,
      actual: outcome === null ? '无适用规则' : stateLabel(outcome.assessment.state),
      actualState: outcome?.assessment.state ?? null,
    })
  }
  return out
}

export interface SimulateResult {
  escalated: number
}

/**
 * 模拟超时通知（演示用）。
 *
 * 不修改系统时间：只把当前事件下未确认的通知按演示策略标记为已升级，
 * 并在通知与操作日志里写明来源是演示模拟，避免与真实超时混淆。
 */
export async function simulateOverdueNotifications(eventId: string): Promise<SimulateResult> {
  requireLocalDemo('模拟超时通知')
  const archive = useArchiveStore()
  const events = useEventsStore()
  const targets = events.notificationsOf(eventId).filter((row) => row.acknowledgedAt === null && row.escalatedAt === null)
  if (targets.length === 0) return { escalated: 0 }
  const at = nowIso()
  for (const row of targets) {
    await putNotification({ ...row, escalatedAt: at, escalatedTo: row.fallback, escalationSource: 'demo' })
  }
  await events.reload()
  const event = events.byId(eventId)
  await archive.log(
    'update',
    'record',
    eventId,
    event?.eventNo ?? eventId,
    `模拟超时通知：${targets.length} 条未确认通知标记为升级`,
    '演示模式模拟，非真实超时；真实系统按黄 30 分钟 / 橙 10 分钟 / 红 5 分钟判定',
  )
  return { escalated: targets.length }
}
