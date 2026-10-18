/**
 * 唯一的一键入口在业务场景之后追加一组当下的模拟传感器采样。
 * 数值是预设演示值，时间是本次载入时刻；不接真实设备，不制造设备心跳。
 */
import { nowIso } from '@/core/time'
import { D_CRACK, D_TH, D_TILT, D_VIB, P_CRACK, P_TH, P_TILT, P_VIB } from '@/db/seedFactories'
import { db } from '@/db/database'
import { buildAuditLog } from '@/db/repo'
import { announceChange } from '@/db/tabSync'
import { useArchiveStore } from '@/stores/archive'
import { useRecordsStore } from '@/stores/records'
import { useSessionStore } from '@/stores/session'
import type { MetricValues, MonitorRecord } from '@/types/domain'
import { DEMO_LIVE_SAMPLE_NOTE } from '@/types/catalog'
import { requireLocalDemo } from '@/api/backend/runtime'

const FRESH_WINDOW_MS = 30 * 60_000

const SAMPLES: { pointId: string; deviceId: string; values: MetricValues[]; unit: string; window: string }[] = [
  { pointId: P_CRACK, deviceId: D_CRACK, values: [{ width: 0.51 }, { width: 0.52 }, { width: 0.54 }, { width: 0.53 }], unit: 'mm', window: '' },
  { pointId: P_TILT, deviceId: D_TILT, values: [{ angleX: 0.06, angleY: -0.02 }, { angleX: 0.07, angleY: -0.02 }, { angleX: 0.07, angleY: -0.03 }, { angleX: 0.08, angleY: -0.03 }], unit: '°', window: '' },
  { pointId: P_VIB, deviceId: D_VIB, values: [{ accelRms: 0.031, accelPeak: 0.10 }, { accelRms: 0.033, accelPeak: 0.12 }, { accelRms: 0.032, accelPeak: 0.11 }, { accelRms: 0.034, accelPeak: 0.11 }], unit: 'm/s²', window: '1 s' },
  { pointId: P_TH, deviceId: D_TH, values: [{ temperature: 26.8, humidity: 62.4 }, { temperature: 27.0, humidity: 62.9 }, { temperature: 27.2, humidity: 63.2 }, { temperature: 27.4, humidity: 63.8 }], unit: '℃ / %RH', window: '' },
]

/** 仅识别本项目旧版种子/剧本标记；手工录入与已修订行永不改来源。 */
function isLegacyDemoSensor(row: MonitorRecord): boolean {
  return (
    row.source === 'manual' && row.revision === 0 && SAMPLES.some((item) => item.pointId === row.pointId) &&
    (row.id.startsWith('rec_seed_') || row.note.startsWith('演示脚本一键导入：') || row.note.startsWith('演示场景导入：'))
  )
}

export async function normalizeLegacyDemoSensors(): Promise<number> {
  requireLocalDemo('旧演示传感器来源校正')
  const session = useSessionStore()
  let changed = 0
  await db.transaction('rw', db.records, db.audits, async () => {
    const legacy = (await db.records.toArray()).filter(isLegacyDemoSensor)
    if (legacy.length === 0) return
    for (const row of legacy) {
      const device = SAMPLES.find((sample) => sample.pointId === row.pointId)?.deviceId ?? row.deviceId
      await db.records.put({ ...row, deviceId: device, source: 'device', enteredBy: '演示传感器模拟器', enteredByRole: 'system' })
    }
    await db.audits.put(buildAuditLog({
      actor: session.name,
      actorRole: session.roleLabel,
      action: 'update',
      objectType: 'system',
      objectId: 'demo-sensor-source',
      objectLabel: '旧版演示传感器来源',
      summary: `将 ${legacy.length} 条可识别的旧演示采样来源校正为传感器数据（演示）`,
      reason: '仅调整演示来源和设备归属，不改采样时间、数值、质量、判定证据或已修订记录',
    }))
    changed = legacy.length
  })
  if (changed === 0) return 0
  await Promise.all([useRecordsStore().reload(), useArchiveStore().reload()])
  announceChange()
  return changed
}

/** 半小时内该点已有更新采样就跳过（含人工记录）；不覆盖它，过期后重按可追加。 */
export async function loadSimulatedLiveSensors(options: { pointIds?: string[]; beforeWrite?: () => void } = {}): Promise<{ created: number; skipped: number }> {
  requireLocalDemo('模拟实时采样')
  const archive = useArchiveStore()
  const records = useRecordsStore()
  await records.reload()
  const at = nowIso()
  let created = 0
  let skipped = 0
  for (const sample of SAMPLES) {
    if (options.pointIds !== undefined && !options.pointIds.includes(sample.pointId)) continue
    options.beforeWrite?.()
    const point = archive.pointById(sample.pointId)
    const device = archive.devices.find((row) => row.id === sample.deviceId)
    if (point?.status !== 'active' || device?.status !== 'active' || device.pointId !== sample.pointId) {
      throw new Error(`模拟实时采样所需测点或设备未在册：${sample.pointId}`)
    }
    const pointRecords = records.ofPoint(sample.pointId)
    const latest = pointRecords[pointRecords.length - 1]
    const gap = latest === undefined ? Number.POSITIVE_INFINITY : Date.parse(at) - Date.parse(latest.sampleTime)
    if (latest !== undefined && gap >= 0 && gap < FRESH_WINDOW_MS) {
      skipped += 1
      continue
    }
    for (const [index, values] of sample.values.entries()) {
      options.beforeWrite?.()
      const sampleTime = new Date(Date.parse(at) - (sample.values.length - index - 1) * 4 * 60_000).toISOString()
      await records.addRecord({
        pointId: sample.pointId,
        deviceId: sample.deviceId,
        values,
        unit: sample.unit,
        sampleTime,
        sampleWindow: sample.window,
        source: 'device',
        quality: 'valid',
        qualityNote: '',
        note: DEMO_LIVE_SAMPLE_NOTE,
      })
      created += 1
    }
  }
  return { created, skipped }
}
