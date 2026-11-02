/**
 * 示例监测记录与操作日志。
 *
 * 裂缝测点只写入方案 §13.2 数据脚本的「初始 0.52 mm」一条，用于显示基准与正常状态；
 * 0.62 / 0.73 / 0.82 与复测值由演示人员按脚本现场录入，这样升级过程才能在演示中真实发生。
 * 另外保留一条模拟历史补录记录，用于验证「补录数据必须标记，不得伪装成实时预警」。
 */
import type { AuditLog, MonitorRecord } from '@/types/domain'
import {
  AT,
  CRACK_BASE,
  D_CRACK,
  D_TH,
  D_TILT,
  D_VIB,
  P_CRACK,
  P_TH,
  P_TILT,
  P_VIB,
  SEED_ACTOR,
  SEED_ROLE,
  TILT_BASE,
  record,
} from './seedFactories'

/** 裂缝与倾角：设有相对基准，记录保存录入时的基准快照。 */
function baselinePointRecords(): MonitorRecord[] {
  return [
    record({
      id: 'rec_seed_01',
      recordNo: 'R20260915-001',
      pointId: P_CRACK,
      deviceId: D_CRACK,
      metric: 'crack_width',
      values: { width: 0.52 },
      unit: 'mm',
      sampleTime: '2026-09-15T10:05',
      baselineValues: CRACK_BASE,
      note: '演示传感器历史采样：初始值相对基准 0.50 mm 变化 +0.02 mm',
    }),
    record({
      id: 'rec_seed_02',
      recordNo: 'R20260916-001',
      pointId: P_TILT,
      deviceId: D_TILT,
      metric: 'tilt_xy',
      values: { angleX: 0.04, angleY: -0.02 },
      unit: '°',
      sampleTime: '2026-09-16T09:45',
      baselineValues: TILT_BASE,
    }),
    record({
      id: 'rec_seed_03',
      recordNo: 'R20260917-001',
      pointId: P_TILT,
      deviceId: D_TILT,
      metric: 'tilt_xy',
      values: { angleX: 0.05, angleY: -0.02 },
      unit: '°',
      sampleTime: '2026-09-17T09:10',
      baselineValues: TILT_BASE,
      enteredDelayMinutes: 3000,
      note: '演示传感器历史采样补录：模拟终端延迟入库，按原始采样时间保留',
    }),
    record({
      id: 'rec_seed_04',
      recordNo: 'R20260918-001',
      pointId: P_TILT,
      deviceId: D_TILT,
      metric: 'tilt_xy',
      values: { angleX: 0.05, angleY: -0.03 },
      unit: '°',
      sampleTime: '2026-09-18T09:20',
      baselineValues: TILT_BASE,
    }),
  ]
}

/** 振动与温湿度：不设相对基准，按绝对判定与环境辅助分别记录。 */
function absolutePointRecords(): MonitorRecord[] {
  return [
    record({
      id: 'rec_seed_05',
      recordNo: 'R20260917-002',
      pointId: P_VIB,
      deviceId: D_VIB,
      metric: 'vibration',
      values: { accelRms: 0.042, accelPeak: 0.15 },
      unit: 'm/s²',
      sampleTime: '2026-09-17T15:10',
      sampleWindow: '1 s',
      baselineValues: null,
    }),
    record({
      id: 'rec_seed_06',
      recordNo: 'R20260918-002',
      pointId: P_VIB,
      deviceId: D_VIB,
      metric: 'vibration',
      values: { accelRms: 0.061, accelPeak: 0.213 },
      unit: 'm/s²',
      sampleTime: '2026-09-18T15:25',
      sampleWindow: '1 s',
      baselineValues: null,
    }),
    record({
      id: 'rec_seed_07',
      recordNo: 'R20260916-002',
      pointId: P_TH,
      deviceId: D_TH,
      metric: 'temp_humidity',
      values: { temperature: 24.6, humidity: 58.2 },
      unit: '℃ / %RH',
      sampleTime: '2026-09-16T14:00',
      baselineValues: null,
    }),
    record({
      id: 'rec_seed_08',
      recordNo: 'R20260918-003',
      pointId: P_TH,
      deviceId: D_TH,
      metric: 'temp_humidity',
      values: { temperature: 26.1, humidity: 61.5 },
      unit: '℃ / %RH',
      sampleTime: '2026-09-18T14:05',
      baselineValues: null,
    }),
  ]
}

export function seedRecords(): MonitorRecord[] {
  return [...baselinePointRecords(), ...absolutePointRecords()]
}

export function seedAudits(): AuditLog[] {
  return [
    {
      id: 'log_seed_01',
      at: AT,
      actor: SEED_ACTOR,
      actorRole: SEED_ROLE,
      action: 'seed',
      objectType: 'system',
      objectId: 'seed',
      objectLabel: '示例校区',
      summary:
        '载入示例校区数据：5 栋楼、13 个楼层、9 个测点（4 个传感器测点 + 5 个人工检查点）、4 台设备、2 条基准、8 条监测记录',
      reason: '首次打开 Demo，用于演示建档与录入；可在设置页清空后从空白重建',
    },
  ]
}
