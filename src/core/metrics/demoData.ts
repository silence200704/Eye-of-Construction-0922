/** 管理报表的临时展示数据：仅驻留内存，使用正常指标计算与筛选。 */
import type { Device, Point } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'
import { fromLocalInput } from '@/core/time'
import { localDayKey } from '@/core/maintenance/plan'
import type { MetricsInput } from './indicators'

const ACTOR = '临时示例人员'
const RESPONSE_HOURS = [0.5, 1, 1.5, 3]

interface SampleContext {
  point: Point
  device?: Device
  key: string
  day: string
  previousDay: string
  index: number
}

function at(day: string, time: string): string {
  return fromLocalInput(`${day}T${time}`)
}

function nextWeek(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return localDayKey(new Date(year, month - 1, date + 7))
}

function audit(createdAt: string, updatedAt = createdAt) {
  return { createdAt, updatedAt, createdBy: ACTOR, updatedBy: ACTOR }
}

function eventSample(context: SampleContext): AlarmEvent {
  const { point, key, day, index } = context
  const openedAt = at(day, '08:00')
  const acknowledgedAt = index === 4 ? null
    : new Date(new Date(openedAt).getTime() + RESPONSE_HOURS[index] * 3_600_000).toISOString()
  return {
    ...audit(openedAt, acknowledgedAt ?? openedAt),
    id: `demo-event-${key}`, eventNo: `示例-E-${key}`, pointId: point.id,
    ruleId: 'demo-report-rule', ruleCode: '临时示例规则',
    level: index === 3 ? 'orange' : 'yellow', peakLevel: index === 3 ? 'orange' : 'yellow',
    status: acknowledgedAt === null ? 'pending' : 'handling', unit: '',
    openedAt, openedBy: ACTOR, lastTriggerAt: openedAt, lastTriggerValue: 0,
    evidences: [], supersededEvidences: [], upgrades: [],
    timeline: [{ at: openedAt, by: ACTOR, action: '临时示例', detail: '用于展示预警响应统计' }],
    acknowledgedAt, acknowledgedBy: acknowledgedAt === null ? '' : ACTOR,
    closedAt: null, closedBy: '', closeBasis: '', note: '临时展示数据',
  }
}

function issueSample(context: SampleContext): InspectionIssue {
  const { point, key, day, previousDay, index } = context
  const createdAt = at(previousDay, '08:00')
  const completedAt = index === 4 ? null : at(day, '14:00')
  const dueDate = index === 3 ? previousDay : day
  return {
    ...audit(createdAt, completedAt ?? createdAt),
    id: `demo-issue-${key}`, issueNo: `示例-ISS-${key}`, source: 'report', submissionKey: `demo-${key}`,
    pointId: point.id, buildingId: point.buildingId, floorId: point.floorId, zoneId: point.zoneId,
    eventId: null, taskId: null, maintenanceTaskId: null,
    anomalyType: '设施外观异常（示例）', description: `${point.name} 临时示例：${index === 4 ? '等待复查' : '现场核查后确认恢复'}`,
    photos: [], status: completedAt === null ? 'pending_recheck' : 'closed',
    reviewAction: 'recheck', reviewCategory: 'remeasure', reviewedAt: at(previousDay, '09:00'),
    reviewedBy: ACTOR, reviewNote: '临时示例：安排现场复查',
    duplicateOf: null, linkedEventId: null, linkedFrom: [], workOrderIds: [],
    rechecks: [{
      subject: '设施外观与固定件复查（示例）', owner: ACTOR, dueDate,
      at: at(previousDay, '10:00'), by: ACTOR,
      outcome: completedAt === null ? null : 'recovered', outcomeAt: completedAt,
      outcomeBy: completedAt === null ? '' : ACTOR, outcomeNote: completedAt === null ? '' : '临时示例：确认恢复',
    }],
    timeline: completedAt === null ? [] : [{
      at: completedAt, by: ACTOR, byRole: '安全管理人员', action: '复查后关闭', detail: '临时展示数据',
    }],
  }
}

function maintenanceSample(context: SampleContext): MaintenanceTask {
  const { point, device, key, day, previousDay, index } = context
  const plannedDay = index === 3 ? previousDay : day
  const plannedAt = at(plannedDay, '09:00')
  const executedAt = index === 4 ? null : at(day, '15:00')
  return {
    ...audit(at(previousDay, '08:00'), executedAt ?? plannedAt),
    id: `demo-maintenance-${key}`, taskNo: `示例-MT-${key}`, planId: `demo-plan-${point.id}`,
    deviceId: device?.id ?? `demo-device-${point.id}`, plannedAt, dueAt: at(plannedDay, '23:59:59'),
    status: executedAt === null ? 'pending' : 'done',
    snapshot: {
      planCode: '临时示例计划', planName: '设备例行保养（示例）',
      deviceCode: device?.code ?? '示例设备', deviceName: device?.name ?? `${point.name} 示意设备`,
      pointId: point.id, buildingId: point.buildingId, floorId: point.floorId, zoneId: point.zoneId,
      owner: ACTOR, cycle: { unit: 'week', interval: 1, atTime: '09:00' },
      checklist: [{ key: 'fixing', label: '固定件检查', required: true, hint: '' }],
    },
    execution: executedAt === null ? null : {
      at: executedAt, by: ACTOR, byRole: '设备管理员',
      checklist: [{ key: 'fixing', label: '固定件检查', result: 'ok', note: '临时示例：固定正常' }],
      measures: '临时示例：清洁探头、检查固定件', materials: '清洁布（示例）', photos: [],
      nextDueDate: nextWeek(day), note: '临时展示数据', abnormalNote: '', issueId: null,
    },
    timeline: [],
  }
}

/** 每栋楼五组：三组按期、一组逾期、一组待处理；日期落在本月及近七天内。 */
export function reportDemoData(input: { today: string; points: Point[]; devices: Device[] }) {
  const result: Pick<MetricsInput, 'events' | 'issues' | 'maintenanceTasks' | 'workOrders'> = {
    events: [], issues: [], maintenanceTasks: [], workOrders: [],
  }
  const points = new Map<string, Point>()
  for (const point of input.points) {
    if (point.status === 'active' && !points.has(point.buildingId)) points.set(point.buildingId, point)
  }
  const [year, month, day] = input.today.split('-').map(Number)
  for (const point of points.values()) {
    for (let index = 0; index < 5; index += 1) {
      const date = new Date(year, month - 1, Math.max(1, day - 5 + index))
      const previous = new Date(year, month - 1, date.getDate() - 1)
      const context: SampleContext = {
        point, device: input.devices.find((row) => row.pointId === point.id),
        key: `${point.code}-${index + 1}`, index,
        day: localDayKey(date), previousDay: localDayKey(previous),
      }
      result.events.push(eventSample(context))
      result.issues.push(issueSample(context))
      result.maintenanceTasks.push(maintenanceSample(context))
    }
  }
  return result
}
