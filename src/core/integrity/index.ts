/**
 * 数据一致性检查：核对编号关联、位置引用与必填基准，
 * 让"档案看起来完整"和"数据真的对得上"分开呈现，避免断链被静默忽略。
 */
import { hasNumericReadings } from '@/types/catalog'
import type { Baseline, Building, Device, Floor, MonitorRecord, Point } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, InspectionPlan, InspectionTask, IssueAttachment, WorkOrder } from '@/types/inspection'
import type { MaintenancePlan, MaintenanceTask } from '@/types/maintenance'
import { checkMaintenanceIssueLinks, checkMaintenanceLinks } from './maintenance'

export interface IntegrityIssue {
  level: 'error' | 'warn'
  kind: string
  objectId: string
  label: string
  message: string
}

export interface IntegrityInput {
  buildings: Building[]
  floors: Floor[]
  points: Point[]
  devices: Device[]
  baselines: Baseline[]
  records: MonitorRecord[]
  /** 预警事件：V0.3 的工单与问题要能回指到它 */
  events?: AlarmEvent[]
  /** V0.3 起纳入；旧调用方可以不传 */
  plans?: InspectionPlan[]
  tasks?: InspectionTask[]
  issues?: InspectionIssue[]
  workOrders?: WorkOrder[]
  attachments?: IssueAttachment[]
  /** V1-D 起纳入：保养计划与任务（含执行照片的归属校验） */
  maintenancePlans?: MaintenancePlan[]
  maintenanceTasks?: MaintenanceTask[]
}

/** 只有相对基准指标才要求先设基准；振动按绝对值判定、温湿度为环境辅助。 */
const NEEDS_BASELINE = new Set(['crack_width', 'tilt_xy'])

function checkPointLinks(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const buildingIds = new Set(data.buildings.map((row) => row.id))
  const floorById = new Map(data.floors.map((row) => [row.id, row]))
  for (const point of data.points) {
    if (!buildingIds.has(point.buildingId)) {
      issues.push({
        level: 'error',
        kind: '测点楼栋引用失效',
        objectId: point.id,
        label: `${point.code} ${point.name}`,
        message: '该测点指向的楼栋已不存在',
      })
    }
    const floor = floorById.get(point.floorId)
    if (floor === undefined) {
      issues.push({
        level: 'error',
        kind: '测点楼层引用失效',
        objectId: point.id,
        label: `${point.code} ${point.name}`,
        message: '该测点指向的楼层已不存在',
      })
    } else if (!floor.zones.includes(point.zoneId)) {
      issues.push({
        level: 'error',
        kind: '测点区域引用失效',
        objectId: point.id,
        label: `${point.code} ${point.name}`,
        message: `所在区域「${point.zoneId}」已不在楼层「${floor.name}」的区域清单中`,
      })
    }
    if (data.devices.every((row) => row.pointId !== point.id) && hasNumericReadings(point.metric)) {
      issues.push({
        level: 'warn',
        kind: '测点未登记设备',
        objectId: point.id,
        label: `${point.code} ${point.name}`,
        message: '该测点尚无绑定设备，读数只能人工录入，也没有量程可用于超量程检查',
      })
    }
    if (NEEDS_BASELINE.has(point.metric) && !data.baselines.some((row) => row.pointId === point.id && row.current)) {
      issues.push({
        level: 'warn',
        kind: '测点缺少基准',
        objectId: point.id,
        label: `${point.code} ${point.name}`,
        message: '该指标按相对基准判定，尚未设置基准，无法计算变化量',
      })
    }
  }
}

function checkDeviceLinks(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const pointIds = new Set(data.points.map((row) => row.id))
  for (const device of data.devices) {
    if (!pointIds.has(device.pointId)) {
      issues.push({
        level: 'error',
        kind: '设备测点引用失效',
        objectId: device.id,
        label: `${device.code} ${device.name}`,
        message: '该设备绑定的测点已不存在',
      })
    }
    if (device.rangeMin !== null && device.rangeMax !== null && device.rangeMin >= device.rangeMax) {
      issues.push({
        level: 'error',
        kind: '设备量程不合法',
        objectId: device.id,
        label: `${device.code} ${device.name}`,
        message: `量程 ${device.rangeMin}~${device.rangeMax} 上下限顺序不对，无法用于超量程判定`,
      })
    }
  }
}

function checkRecordLinks(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const pointIds = new Set(data.points.map((row) => row.id))
  const orphans = data.records.filter((row) => !pointIds.has(row.pointId))
  if (orphans.length > 0) {
    issues.push({
      level: 'error',
      kind: '记录测点引用失效',
      objectId: 'records',
      label: `${orphans.length} 条监测记录`,
      message: `记录编号 ${orphans
        .slice(0, 5)
        .map((row) => row.recordNo)
        .join('、')}${orphans.length > 5 ? ' 等' : ''} 指向的测点已不存在`,
    })
  }
  const conflicting = data.baselines.filter((row) => row.current)
  const byPoint = new Map<string, number>()
  for (const row of conflicting) byPoint.set(row.pointId, (byPoint.get(row.pointId) ?? 0) + 1)
  for (const [pointId, count] of byPoint) {
    if (count > 1) {
      issues.push({
        level: 'error',
        kind: '基准版本冲突',
        objectId: pointId,
        label: pointId,
        message: `该测点同时有 ${count} 条基准被标记为当前生效，历史记录的基准快照无法解释`,
      })
    }
  }
}

function checkFloorZones(data: IntegrityInput, issues: IntegrityIssue[]): void {
  for (const floor of data.floors) {
    if (floor.zones.length === 0) {
      issues.push({
        level: 'warn',
        kind: '楼层缺少区域',
        objectId: floor.id,
        label: floor.name,
        message: '楼层没有区域清单，楼层图无法生成，测点也无处落位',
      })
    }
  }
}

/**
 * 标签编号唯一性：两个测点绑同一张卡时，两个任务都可能判成"到点"。
 * 这是到点证明能否成立的前提，因此按错误级别报出。
 */
function checkLabelUnique(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const seen = new Map<string, Point>()
  for (const point of data.points) {
    if (point.status !== 'active') continue
    const code = point.nfc?.code?.trim() ?? ''
    if (code === '') continue
    const first = seen.get(code)
    if (first === undefined) {
      seen.set(code, point)
      continue
    }
    issues.push({
      level: 'error',
      kind: 'NFC 标签编号重复',
      objectId: point.id,
      label: `${point.code} ${point.name}`,
      message: `标签 ${code} 同时绑在 ${first.code} ${first.name} 上，一个编号只能绑一个测点`,
    })
  }
}

/** 巡检计划与任务：楼栋、楼层、测点、计划引用是否还有效。 */
function checkInspectionLinks(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const buildingIds = new Set(data.buildings.map((row) => row.id))
  const floorById = new Map(data.floors.map((row) => [row.id, row]))
  const pointById = new Map(data.points.map((row) => [row.id, row]))
  const planById = new Map((data.plans ?? []).map((row) => [row.id, row]))

  for (const plan of data.plans ?? []) {
    const label = `${plan.code} ${plan.name}`
    if (!buildingIds.has(plan.buildingId)) {
      issues.push({ level: 'error', kind: '计划楼栋引用失效', objectId: plan.id, label, message: '计划指向的楼栋已不存在' })
    }
    for (const floorId of plan.floorIds) {
      if (!floorById.has(floorId)) {
        issues.push({ level: 'error', kind: '计划楼层引用失效', objectId: plan.id, label, message: `计划包含的楼层 ${floorId} 已不存在` })
      }
    }
    if (plan.pointIds.length === 0) {
      issues.push({ level: 'warn', kind: '计划没有必查点', objectId: plan.id, label, message: '计划未登记必查点，生成的任务不会有检查内容' })
    }
    for (const pointId of plan.pointIds) {
      if (!pointById.has(pointId)) {
        issues.push({ level: 'error', kind: '计划测点引用失效', objectId: plan.id, label, message: `必查点 ${pointId} 已不存在` })
      }
    }
  }

  for (const task of data.tasks ?? []) {
    const label = `${task.taskNo}`
    const plan = planById.get(task.planId)
    if (plan === undefined) {
      issues.push({ level: 'error', kind: '任务计划引用失效', objectId: task.id, label, message: '任务关联的巡检计划已不存在' })
    }
    if (!buildingIds.has(task.buildingId)) {
      issues.push({ level: 'error', kind: '任务楼栋引用失效', objectId: task.id, label, message: '任务指向的楼栋已不存在' })
    }
    for (const row of task.results) {
      if (!pointById.has(row.pointId)) {
        issues.push({ level: 'error', kind: '任务测点引用失效', objectId: task.id, label, message: `任务里的点位 ${row.pointId} 已不存在` })
      }
    }
  }
}

/** 问题、工单与附件：引用是否有效、照片 ID 是否真的存在、附件是否挂在了对象上（含保养任务）。 */
function checkDisposalLinks(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const pointIds = new Set(data.points.map((row) => row.id))
  const taskIds = new Set((data.tasks ?? []).map((row) => row.id))
  const eventIds = new Set((data.events ?? []).map((row: AlarmEvent) => row.id))
  const issueById = new Map((data.issues ?? []).map((row) => [row.id, row]))

  for (const issue of data.issues ?? []) {
    const label = `${issue.issueNo} ${issue.anomalyType}`
    if (issue.pointId !== null && !pointIds.has(issue.pointId)) {
      issues.push({ level: 'error', kind: '问题测点引用失效', objectId: issue.id, label, message: '问题指向的测点已不存在' })
    }
    if (issue.taskId !== null && !taskIds.has(issue.taskId)) {
      issues.push({ level: 'error', kind: '问题任务引用失效', objectId: issue.id, label, message: '问题关联的巡检任务已不存在' })
    }
    if (issue.eventId !== null && !eventIds.has(issue.eventId)) {
      issues.push({ level: 'error', kind: '问题事件引用失效', objectId: issue.id, label, message: '问题关联的预警事件已不存在' })
    }
    if (issue.duplicateOf !== null && !issueById.has(issue.duplicateOf)) {
      issues.push({ level: 'error', kind: '重复关联失效', objectId: issue.id, label, message: '问题关联的原记录已不存在' })
    }
  }

  for (const order of data.workOrders ?? []) {
    const label = `${order.orderNo} ${order.title}`
    if (order.issueId !== null && !issueById.has(order.issueId)) {
      issues.push({ level: 'error', kind: '工单问题引用失效', objectId: order.id, label, message: '工单关联的问题已不存在' })
    }
    if (order.eventId !== null && !eventIds.has(order.eventId)) {
      issues.push({ level: 'error', kind: '工单事件引用失效', objectId: order.id, label, message: '工单关联的预警事件已不存在' })
    }
    if (order.pointId !== null && !pointIds.has(order.pointId)) {
      issues.push({ level: 'error', kind: '工单测点引用失效', objectId: order.id, label, message: '工单指向的测点已不存在' })
    }
  }
}

/**
 * 附件的双向校验：照片必须**有且只有一个归属**（问题 / 工单 / 保养任务），
 * 而且**归属它的对象列出的每一张照片，附件的归属字段必须真的是它**。
 *
 * 只查"照片存在"是不够的：一张挂在别的问题下的照片被列进本条问题的照片列表里，
 * 界面上看着有图、出处却是另一条记录 —— 这种错必须能自己查出来，而不是等人工发现。
 */
function checkAttachmentOwners(data: IntegrityInput, issues: IntegrityIssue[]): void {
  const attachmentById = new Map((data.attachments ?? []).map((row) => [row.id, row]))
  const issueById = new Map((data.issues ?? []).map((row) => [row.id, row]))
  const orderIds = new Set((data.workOrders ?? []).map((row) => row.id))
  const maintenanceIds = new Set((data.maintenanceTasks ?? []).map((row) => row.id))

  for (const issue of data.issues ?? []) {
    const label = `${issue.issueNo} ${issue.anomalyType}`
    for (const photoId of issue.photos) {
      const found = attachmentById.get(photoId)
      if (found === undefined) {
        issues.push({ level: 'error', kind: '问题照片丢失', objectId: issue.id, label, message: `照片 ${photoId} 在附件表中不存在` })
      } else if (found.issueId !== issue.id) {
        issues.push({ level: 'error', kind: '问题照片归属不符', objectId: issue.id, label, message: `照片 ${photoId} 的归属不是本条问题（归属 ${found.issueId ?? '其他对象'}）` })
      }
    }
  }

  for (const order of data.workOrders ?? []) {
    const label = `${order.orderNo} ${order.title}`
    for (const photoId of order.photos) {
      const found = attachmentById.get(photoId)
      if (found === undefined) {
        issues.push({ level: 'error', kind: '工单照片丢失', objectId: order.id, label, message: `照片 ${photoId} 在附件表中不存在` })
      } else if (found.workOrderId !== order.id) {
        issues.push({ level: 'error', kind: '工单照片归属不符', objectId: order.id, label, message: `照片 ${photoId} 的归属不是本工单（归属 ${found.workOrderId ?? '其他对象'}）` })
      }
    }
  }

  for (const task of data.maintenanceTasks ?? []) {
    const label = `${task.taskNo} ${task.snapshot.deviceName}`.trim()
    for (const photoId of task.execution?.photos ?? []) {
      const found = attachmentById.get(photoId)
      if (found === undefined) {
        issues.push({ level: 'error', kind: '保养照片丢失', objectId: task.id, label, message: `照片 ${photoId} 在附件表中不存在` })
      } else if ((found.maintenanceTaskId ?? null) !== task.id) {
        issues.push({ level: 'error', kind: '保养照片归属不符', objectId: task.id, label, message: `照片 ${photoId} 的归属不是本条保养任务（归属 ${found.maintenanceTaskId ?? '其他对象'}）` })
      }
    }
  }

  for (const row of data.attachments ?? []) {
    /*
     * 附件必须**有且只有一个归属**（问题 / 工单 / 保养任务），一个都没有就是孤儿数据，谁也看不到它；
     * 挂多个也同样有问题 —— 同一张照片同时属于两处，删除任一处时到底该不该删就说不清了。
     */
    const owners = [row.issueId, row.workOrderId, row.maintenanceTaskId ?? null].filter((value) => value !== null)
    if (owners.length === 0) {
      issues.push({
        level: 'error',
        kind: '附件未关联对象',
        objectId: row.id,
        label: row.fileName,
        message: '照片既没关联问题、工单，也没关联保养任务，属于游离数据',
      })
      continue
    }
    if (owners.length > 1) {
      // 不 continue：归属不唯一本身要报，它挂的每个引用是否存在也要各自核一遍（两个问题都要能修）
      issues.push({
        level: 'error',
        kind: '附件归属不唯一',
        objectId: row.id,
        label: row.fileName,
        message: '照片同时关联了多个对象，归属必须唯一',
      })
    }
    if (row.issueId !== null && !issueById.has(row.issueId)) {
      issues.push({ level: 'error', kind: '附件问题引用失效', objectId: row.id, label: row.fileName, message: '照片关联的问题已不存在' })
    }
    if (row.workOrderId !== null && !orderIds.has(row.workOrderId)) {
      issues.push({ level: 'error', kind: '附件工单引用失效', objectId: row.id, label: row.fileName, message: '照片关联的工单已不存在' })
    }
    if ((row.maintenanceTaskId ?? null) !== null && !maintenanceIds.has(row.maintenanceTaskId as string)) {
      issues.push({ level: 'error', kind: '附件保养任务引用失效', objectId: row.id, label: row.fileName, message: '照片关联的保养任务已不存在' })
    }
  }
}

export function scanIntegrity(data: IntegrityInput): IntegrityIssue[] {
  const issues: IntegrityIssue[] = []
  checkPointLinks(data, issues)
  checkDeviceLinks(data, issues)
  checkRecordLinks(data, issues)
  checkFloorZones(data, issues)
  checkLabelUnique(data, issues)
  checkInspectionLinks(data, issues)
  checkDisposalLinks(data, issues)
  checkAttachmentOwners(data, issues)
  // 保养相关的两类检查在 ./maintenance：文件超过 450 行后按主题拆开
  checkMaintenanceLinks(data, issues)
  checkMaintenanceIssueLinks(data, issues)
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
}
