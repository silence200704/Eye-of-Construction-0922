/**
 * V2-1 接口样例：每类资源一组**真实业务样例**，每类写动作一条可过校验的请求。
 *
 * 样例全部取自 2026-09-29 实机走通的那条链（B01 一层走廊闭门器 与 B03 二层裂缝），
 * 不是编出来的字段堆。它们同时是**可执行的**：`tests/api/contract.test.ts` 会逐条校验
 * - 读样例：主键形态、业务编号规则、状态字典、时间可解析、附件归属唯一；
 * - 写样例：`evaluateWrite()` 必须放行（因此样例本身就是"契约没写错"的证据）。
 */
import { idempotencyKeyOf } from './envelope'
import type { ActorRef, RequestMeta, ScopeRef } from './envelope'
import type { WriteTarget, WriteRequest } from './guard'
import type { WriteAction } from './scope'
import { isBusinessNumber, isPrimaryKey, numberRuleOf } from './ids'
import type { ArchiveDto, EventDto, IssueDto, MediaDto, RecordDto, ResourceDto, ResourceName, TaskDto, WorkOrderDto } from './resources'
import { STATUS_DICTS } from './states'
import type { StatusResource } from './states'

export const SAMPLE_NOW = '2026-09-29T14:07:12.838Z'

/** 主键样例：除任务类用业务键主键外，其余是"前缀 + 不透明串"。 */
export const SAMPLE_IDS = {
  building: 'bld_mumq1jy16249d',
  pointManual: 'pnt_b01_f1_check01',
  pointCrack: 'pnt_b03_f2_crack01',
  record: 'rec_mumq7mscou0be',
  event: 'evt_mumq5jy16249d',
  issue: 'iss_cmVwb3J0OnBudF9iMDFfZjFfY2hlY2swMTrorr7lpIfmlYXpmpw6Mjk4NDQ4Mw',
  workOrder: 'wo_mumqr0ta234l3j',
  /** 业务键主键：计划ID@执行时刻 */
  task: 'plan_mumq1jy16249d@2026-09-29T01:00:00.000Z',
  attachment: 'att_mumqzpx543aw7',
} as const

export interface ReadSample {
  resource: ResourceName
  label: string
  dto: ResourceDto
  note: string
}

export const READ_SAMPLES: ReadSample[] = [
  {
    resource: 'archive', label: '测点档案 B01-F1-CHECK01（人工检查点，不产生数值记录）',
    note: '人工检查点只建档与定位；NFC 未绑定时 nfc 为 null，界面写"未登记标签"',
    dto: {
      id: SAMPLE_IDS.pointManual, kind: 'point', code: 'B01-F1-CHECK01', name: '一层走廊人工检查点',
      buildingId: 'bld_mumq1jy16249d', pointId: null, status: 'active', dataSource: 'demo', source: '示例校区建档',
      version: null, pointType: 'manual_check', metric: 'inspection', health: null,
      createdAt: '2026-09-20T01:00:00.000Z', createdBy: '李老师', updatedAt: '2026-09-20T01:00:00.000Z',
      updatedBy: '李老师', rev: 1,
    } satisfies ArchiveDto,
  },
  {
    resource: 'record', label: '裂缝读数 0.32 mm（有效，设备补录，触发红色事件的那条证据）',
    note: 'baselineVersion/baselineValues 是录入当时的基准快照，事后调基准不改历史解释',
    dto: {
      id: SAMPLE_IDS.record, recordNo: 'R20260920-001', pointId: 'pnt_b03_f2_crack01', deviceId: 'dev_mumq1jy16249d',
      metric: 'crack_width', values: { width: 0.32 }, unit: 'mm', sampleTime: '2026-09-20T01:00:00.000Z',
      sampleWindow: '', enteredAt: '2026-09-20T01:05:00.000Z', enteredBy: '设备管理员', source: 'device',
      quality: 'valid', qualityNote: '', isBackfill: false, baselineVersion: 1, baselineValues: { width: 0 }, revision: 0, rev: 1,
    } satisfies RecordDto,
  },
  {
    resource: 'event', label: '红色事件 E20260918-001（B03 二层西墙裂缝测点，恢复待确认）',
    note: 'level 是当前等级、peakLevel 是历史最高；ruleVersion 给出"当时按哪版阈值判的"',
    dto: {
      id: SAMPLE_IDS.event, eventNo: 'E20260918-001', pointId: 'pnt_b03_f2_crack01',
      ruleId: 'rul_mumq1jy16249d', ruleCode: 'RULE-CRACK-001', ruleVersion: 'V1.0', level: 'orange', peakLevel: 'red',
      status: 'recovering', unit: 'mm', openedAt: '2026-09-18T02:00:00.000Z', openedBy: '系统判定',
      lastTriggerAt: '2026-09-20T01:00:00.000Z', lastTriggerValue: 0.32, evidenceCount: 1,
      acknowledgedAt: '2026-09-18T02:30:00.000Z', closedAt: null, closedBy: '', closeBasis: '', rev: 4,
    } satisfies EventDto,
  },
  {
    resource: 'issue', label: '问题 ISS-20260929-002（人工上报 → 转维修工单 → 待复查）',
    note: 'submissionKey 是幂等键（同键重复上报不重复建单）；recheckRounds 报轮次而不是只报状态',
    dto: {
      id: SAMPLE_IDS.issue, issueNo: 'ISS-20260929-002', source: 'report',
      submissionKey: 'report|pnt_b01_f1_check01|设备故障|20260929', pointId: SAMPLE_IDS.pointManual,
      buildingId: 'bld_mumq1jy16249d', floorId: 'flr_mumq1jy16249d', zoneId: 'zn_mumq1jy16249d',
      eventId: null, taskId: null, maintenanceTaskId: null, anomalyType: '设备故障',
      status: 'pending_recheck', reviewAction: 'to_repair', reviewCategory: 'equipment',
      reviewedAt: '2026-09-29T13:57:46.848Z', reviewedBy: '李老师', workOrderIds: [SAMPLE_IDS.workOrder],
      recheckRounds: 0, latestOutcome: null, createdAt: '2026-09-29T13:57:46.848Z',
      updatedAt: '2026-09-29T14:07:12.838Z', rev: 5,
    } satisfies IssueDto,
  },
  {
    resource: 'workOrder', label: '工单 WO-20260929-002（派工 → 接单 → 提交 → 验收通过，跨两次身份切换）',
    note: 'assignee 可能是角色名或姓名；验收通过只把问题推进到待复查，不自动关闭',
    dto: {
      id: SAMPLE_IDS.workOrder, orderNo: 'WO-20260929-002', origin: 'issue', issueId: SAMPLE_IDS.issue,
      eventId: null, pointId: SAMPLE_IDS.pointManual, title: '设备故障（ISS-20260929-002）', status: 'verified',
      assignee: '维修人员', assignedBy: '演示操作员', assignedAt: '2026-09-29T14:04:32.633Z', dueAt: null,
      measures: '更换闭门器本体并调整闭门速度，测试自动回位正常', materials: '闭门器 1 套、自攻螺钉 4 枚',
      submittedAt: '2026-09-29T14:06:00.000Z', reviewedAt: '2026-09-29T14:07:12.838Z', photoCount: 1,
      createdAt: '2026-09-29T13:57:46.848Z', updatedAt: '2026-09-29T14:07:12.838Z', rev: 5,
    } satisfies WorkOrderDto,
  },
  {
    resource: 'task', label: '巡检任务 TK-20260929-001（业务键主键：计划ID@执行时刻）',
    note: '任务范围与执行角色取生成时快照；任务完成不等于问题解决',
    dto: {
      id: SAMPLE_IDS.task, taskNo: 'TK-20260929-001', kind: 'inspection', planId: 'plan_mumq1jy16249d',
      planCode: 'PLAN-20260920-001', buildingId: 'bld_mumq1jy16249d', plannedAt: '2026-09-29T01:00:00.000Z',
      dueAt: '2026-09-29T09:00:00.000Z', status: 'pending', owner: '周老师', executorRole: 'inspector',
      checkedCount: 0, totalCount: 3, createdAt: '2026-09-29T01:00:00.000Z', updatedAt: '2026-09-29T01:00:00.000Z', rev: 1,
    } satisfies TaskDto,
  },
  {
    resource: 'media', label: '验收照片（归属工单，不是游离附件）',
    note: '归属唯一：问题 / 工单 / 保养任务三者恰有其一（实测 9 条附件全部单归属）；本地演示 sha256 为 null，不假装有校验和',
    dto: {
      id: 'att_draft_mumr2tr5i9h9', ownerType: 'workOrder', ownerId: SAMPLE_IDS.workOrder, issueId: null,
      workOrderId: SAMPLE_IDS.workOrder, maintenanceTaskId: null, kind: 'acceptance', draftId: 'draft_mumr2tr5i9h9',
      fileName: '验收照片-闭门器更换后.png', mimeType: 'image/png', size: 4479, width: 320, height: 240,
      uploadedAt: SAMPLE_NOW, uploadedBy: '演示操作员', capturedAt: '2026-09-29T14:00:00.000Z',
      sha256: null, rev: 1,
    } satisfies MediaDto,
  },
]

/* ------------------------------ 样例校验 ------------------------------ */

const ISO_FIELDS = ['createdAt', 'updatedAt', 'at', 'sampleTime', 'enteredAt', 'openedAt', 'uploadedAt', 'plannedAt', 'dueAt', 'lastTriggerAt', 'assignedAt', 'submittedAt', 'reviewedAt', 'acknowledgedAt', 'capturedAt']

function isIso(value: unknown): boolean {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value))
}

/** 档案类资源下同为 `code` 的编号要按子类型区分（楼栋 B01 / 测点 B01-F1-CHECK01 不是一条规则）。 */
function sampleKind(sample: ReadSample): string | undefined {
  const kind = (sample.dto as unknown as { kind?: string }).kind
  return sample.resource === 'archive' ? kind : undefined
}

/** 各资源的状态字段 → 状态字典（校验"样例里的状态确实在冻结字典里"）。 */
const STATUS_OF: Partial<Record<ResourceName, { field: string; dict: StatusResource }[]>> = {
  issue: [{ field: 'status', dict: 'issue' }],
  workOrder: [{ field: 'status', dict: 'workOrder' }],
  task: [{ field: 'status', dict: 'task' }],
  event: [
    { field: 'status', dict: 'event' },
    { field: 'level', dict: 'eventLevel' },
    { field: 'peakLevel', dict: 'eventLevel' },
  ],
}

/** 返回样例的问题清单；空数组表示通过。 */
export function sampleIssues(sample: ReadSample): string[] {
  const problems: string[] = []
  const dto = sample.dto as unknown as Record<string, unknown>
  if (!isPrimaryKey(String(dto.id ?? ''))) problems.push(`主键形态不合法：${String(dto.id)}`)
  if (!Number.isInteger(dto.rev) || (dto.rev as number) < 1) problems.push('rev 必须是 ≥1 的整数')
  for (const field of ISO_FIELDS) {
    if (field in dto && dto[field] !== null && !isIso(dto[field])) problems.push(`时间字段不可解析：${field}`)
  }
  for (const field of ['code', 'recordNo', 'eventNo', 'issueNo', 'orderNo', 'taskNo']) {
    if (!(field in dto) || numberRuleOf(sample.resource, field, sampleKind(sample)) === undefined) continue
    if (!isBusinessNumber(sample.resource, field, String(dto[field]), sampleKind(sample))) {
      problems.push(`业务编号不符合规则：${field}=${String(dto[field])}`)
    }
  }
  for (const row of STATUS_OF[sample.resource] ?? []) {
    if (!(row.field in dto)) continue
    const value = String(dto[row.field])
    if (!(STATUS_DICTS[row.dict] as readonly { key: string }[]).some((s) => s.key === value)) {
      problems.push(`状态不在字典里：${row.field}=${value}`)
    }
  }
  if (sample.resource === 'media') {
    const owners = [dto.issueId, dto.workOrderId, dto.maintenanceTaskId].filter((value) => value !== null && value !== undefined)
    if (owners.length !== 1) problems.push('附件必须有且只有一个归属')
    if (dto.ownerId !== owners[0]) problems.push('ownerType/ownerId 与归属字段不一致')
  }
  return problems
}

/* ------------------------------ 写请求样例 ------------------------------ */

const SAFETY: ActorRef = { name: '演示操作员', role: 'safety' }
const REPAIR: ActorRef = { name: '维修人员', role: 'repair' }
const PROPERTY: ActorRef = { name: '物业值班人员', role: 'property' }
const INSPECTOR: ActorRef = { name: '周老师', role: 'inspector' }
const DEVICE: ActorRef = { name: '设备管理员', role: 'device' }
const ALL_SCOPE: ScopeRef = { buildingIds: null }

function target(over: Partial<WriteTarget> = {}): WriteTarget {
  return { exists: true, buildingId: 'bld_mumq1jy16249d', status: null, rev: 3, assignedTo: null, requiredRole: null, machine: null, ...over }
}

function meta(action: WriteAction, parts: string[], expectedRev: number | null = 3): RequestMeta {
  return { idempotencyKey: idempotencyKeyOf(action, parts), expectedRev, at: SAMPLE_NOW, note: '' }
}

export interface WriteSample extends WriteRequest {
  label: string
}

export const WRITE_SAMPLES: WriteSample[] = [
  { label: '维护测点档案', action: 'archive_write', actor: DEVICE, scope: ALL_SCOPE, target: target(), meta: meta('archive_write', [SAMPLE_IDS.pointManual]), payload: { kind: 'point', code: 'B01-F1-CHECK01', name: '一层走廊人工检查点' } },
  { label: '录入一条裂缝读数', action: 'record_write', actor: DEVICE, scope: ALL_SCOPE, target: target(), meta: meta('record_write', ['pnt_b03_f2_crack01', '2026-09-20T01:00:00.000Z', 'crack_width']), payload: { pointId: 'pnt_b03_f2_crack01', metric: 'crack_width', sampleTime: '2026-09-20T01:00:00.000Z', unit: 'mm', quality: 'valid', values: { width: 0.32 }, note: '设备补录' } },
  { label: '修订一条已入库记录', action: 'record_revise', actor: DEVICE, scope: ALL_SCOPE, target: target(), meta: meta('record_revise', [SAMPLE_IDS.record, '1']), payload: { recordId: SAMPLE_IDS.record, revision: 1, reason: '现场复测后更正采样时刻' } },
  { label: '确认预警事件', action: 'event_acknowledge', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'pending', machine: 'event', buildingId: null }), meta: meta('event_acknowledge', [SAMPLE_IDS.event], null), payload: { eventId: SAMPLE_IDS.event } },
  { label: '关闭预警事件（恢复待确认 + 验收通过的关联工单）', action: 'event_close', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'recovering', machine: 'event', buildingId: null }), meta: meta('event_close', [SAMPLE_IDS.event]), payload: { eventId: SAMPLE_IDS.event, basis: '连续 3 条恢复复测低于恢复阈值，关联工单已验收通过', basisDetail: '工单 WO-20260929-002 已验收通过' } },
  { label: '人工上报问题', action: 'issue_report', actor: INSPECTOR, scope: ALL_SCOPE, target: target({ rev: null }), meta: meta('issue_report', ['pnt_b01_f1_check01', '设备故障', '周老师', '20260929'], null), payload: { pointId: 'pnt_b01_f1_check01', buildingId: 'bld_mumq1jy16249d', floorId: 'flr_mumq1jy16249d', zoneId: 'zn_mumq1jy16249d', anomalyType: '设备故障', description: '一层走廊应急指示灯不亮', photoDraftIds: [] } },
  { label: '预警转问题', action: 'issue_from_event', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'handling', machine: 'event' }), meta: meta('issue_from_event', [SAMPLE_IDS.event]), payload: { eventId: SAMPLE_IDS.event, buildingId: 'bld_mumq1jy16249d', anomalyType: '裂缝', description: '红色预警转为问题处置' } },
  { label: '审核：转维修工单', action: 'issue_review', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'pending_review' }), meta: meta('issue_review', [SAMPLE_IDS.issue, SAMPLE_NOW]), payload: { issueId: SAMPLE_IDS.issue, action: 'to_repair', category: 'equipment', note: '设备故障，转维修工单处理' } },
  { label: '登记复查', action: 'issue_recheck_register', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'pending_recheck' }), meta: meta('issue_recheck_register', [SAMPLE_IDS.issue, '1']), payload: { issueId: SAMPLE_IDS.issue, round: 1, subject: '闭门器回位与固定情况', owner: '李老师', dueDate: '2026-10-06' } },
  { label: '复查结论：继续观察', action: 'issue_recheck_outcome', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'pending_recheck' }), meta: meta('issue_recheck_outcome', [SAMPLE_IDS.issue, '1']), payload: { issueId: SAMPLE_IDS.issue, round: 1, outcome: 'observing', nextDueDate: '2026-10-13', note: '现场正常，延长观察一周期' } },
  { label: '派工', action: 'work_order_dispatch', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'created', machine: 'workOrder' }), meta: meta('work_order_dispatch', [SAMPLE_IDS.workOrder, '维修人员', SAMPLE_NOW]), payload: { orderId: SAMPLE_IDS.workOrder, to: 'assigned', assignee: '维修人员', dueAt: null } },
  { label: '接单（被派工人本人）', action: 'work_order_accept', actor: REPAIR, scope: ALL_SCOPE, target: target({ status: 'assigned', machine: 'workOrder', assignedTo: '维修人员' }), meta: meta('work_order_accept', [SAMPLE_IDS.workOrder, SAMPLE_NOW]), payload: { orderId: SAMPLE_IDS.workOrder, to: 'repairing', note: '22:10 到场' } },
  { label: '物业值班代接（必须写明代接原因）', action: 'work_order_accept', actor: PROPERTY, scope: ALL_SCOPE, target: target({ status: 'assigned', machine: 'workOrder', assignedTo: '孙老师' }), meta: meta('work_order_accept', [SAMPLE_IDS.workOrder, SAMPLE_NOW]), payload: { orderId: SAMPLE_IDS.workOrder, to: 'repairing', note: '原维修人外出，物业值班代接到场查看' } },
  { label: '提交待验收', action: 'work_order_submit', actor: REPAIR, scope: ALL_SCOPE, target: target({ status: 'repairing', machine: 'workOrder', assignedTo: '维修人员' }), meta: meta('work_order_submit', [SAMPLE_IDS.workOrder, SAMPLE_NOW]), payload: { orderId: SAMPLE_IDS.workOrder, to: 'submitted', measures: '更换闭门器本体并调整闭门速度', materials: '闭门器 1 套' } },
  { label: '验收通过', action: 'work_order_verify', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'submitted', machine: 'workOrder' }), meta: meta('work_order_verify', [SAMPLE_IDS.workOrder, SAMPLE_NOW]), payload: { orderId: SAMPLE_IDS.workOrder, to: 'verified', note: '现场复核回位正常，验收通过' } },
  { label: '验收退回（必须写原因）', action: 'work_order_verify', actor: SAFETY, scope: ALL_SCOPE, target: target({ status: 'submitted', machine: 'workOrder' }), meta: meta('work_order_verify', [SAMPLE_IDS.workOrder, SAMPLE_NOW]), payload: { orderId: SAMPLE_IDS.workOrder, to: 'returned', note: '色差明显，重新处理后再验' } },
  { label: '到点签到', action: 'inspection_checkin', actor: INSPECTOR, scope: ALL_SCOPE, target: target({ status: 'pending', requiredRole: 'inspector' }), meta: meta('inspection_checkin', [SAMPLE_IDS.task, 'pnt_b01_f1_check01', SAMPLE_NOW]), payload: { taskId: SAMPLE_IDS.task, pointId: 'pnt_b01_f1_check01', method: 'nfc', labelRead: 'NFC-B01-F1-CHECK01' } },
  { label: '完成检查并上报异常', action: 'inspection_complete', actor: INSPECTOR, scope: ALL_SCOPE, target: target({ status: 'pending', requiredRole: 'inspector' }), meta: meta('inspection_complete', [SAMPLE_IDS.task, 'pnt_b01_f1_check01', SAMPLE_NOW]), payload: { taskId: SAMPLE_IDS.task, pointId: 'pnt_b01_f1_check01', abnormalCount: 1, createIssue: true } },
  { label: '生成当日保养任务', action: 'maintenance_generate', actor: PROPERTY, scope: ALL_SCOPE, target: target({ rev: null }), meta: meta('maintenance_generate', ['mp_mumq1jy16249d', '2026-09-29'], null), payload: { planId: 'mp_mumq1jy16249d', dayKey: '2026-09-29' } },
  { label: '执行保养', action: 'maintenance_execute', actor: PROPERTY, scope: ALL_SCOPE, target: target({ status: 'pending', assignedTo: '王老师' }), meta: meta('maintenance_execute', ['mt_mumq1jy16249d@2026-09-29T01:00:00.000Z']), payload: { taskId: 'mt_mumq1jy16249d@2026-09-29T01:00:00.000Z', measures: '检查并紧固支架', note: '原负责人外出，物业值班代执行' } },
  { label: '上传验收照片', action: 'attachment_upload', actor: SAFETY, scope: ALL_SCOPE, target: target({ rev: null }), meta: meta('attachment_upload', ['draft_mumqzpx543aw7'], null), payload: { draftId: 'draft_mumqzpx543aw7', kind: 'acceptance', ownerType: 'workOrder', ownerId: SAMPLE_IDS.workOrder, workOrderId: SAMPLE_IDS.workOrder, fileName: '验收照片-闭门器更换后.png', mimeType: 'image/png', size: 4479, width: 320, height: 240 } },
]
