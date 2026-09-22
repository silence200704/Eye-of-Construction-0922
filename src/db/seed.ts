/**
 * 示例校区数据入口：首次打开 Demo 时载入，可在设置页清空后从空白重建。
 */
import type { Dataset } from './repo'
import { seedRules } from '@/config/ruleSeed'
import { seedBaselines, seedBuildings, seedDevices, seedFloors, seedPoints } from './seedArchive'
import { seedAudits, seedRecords } from './seedRecords'

export function seedDataset(): Dataset {
  return {
    buildings: seedBuildings(),
    floors: seedFloors(),
    points: seedPoints(),
    devices: seedDevices(),
    baselines: seedBaselines(),
    records: seedRecords(),
    audits: seedAudits(),
    rules: seedRules(),
    events: [],
    notifications: [],
    // V0.3 的巡检数据不预置：现场按脚本从建计划开始走，避免"预置完成记录替代现场操作"
    plans: [],
    tasks: [],
    issues: [],
    workOrders: [],
    attachments: [],
  }
}
