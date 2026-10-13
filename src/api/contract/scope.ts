/**
 * V2-1 契约冻结 · 权限矩阵。
 *
 * 每个写动作一行：允许的角色、依据（现有代码里的拦截位置）、以及**今天到底拦在哪一层**。
 * `enforced` 是这份矩阵最该被审的地方：
 * - `store`：现有仓储/纯函数里真的拦了（越权直接返回错误）；
 * - `ui-only`：只在界面上隐藏按钮，**直接调 store 仍可写入** —— V2-2 必须在服务端补拦；
 * - `open`：设计上任何身份都能做（例如人工上报），仍然受楼栋范围约束。
 *
 * 角色键沿用 `@/types/catalog` 的 ROLES：safety / property / device / inspector / repair / reviewer。
 */
import { scopeAllowsBuilding } from './envelope'
import type { ScopeRef } from './envelope'
import type { ResourceName } from './resources'

export const WRITE_ACTIONS = [
  'archive_write',
  'record_write',
  'record_revise',
  'event_acknowledge',
  'event_close',
  'issue_report',
  'issue_from_event',
  'issue_review',
  'issue_recheck_register',
  'issue_recheck_outcome',
  'work_order_dispatch',
  'work_order_accept',
  'work_order_submit',
  'work_order_verify',
  'inspection_checkin',
  'inspection_complete',
  'maintenance_generate',
  'maintenance_execute',
  'attachment_upload',
] as const

export type WriteAction = (typeof WRITE_ACTIONS)[number]

export type Enforcement = 'store' | 'ui-only' | 'open'

export interface ActionRule {
  label: string
  /** 允许的角色键；'*' = 任意身份（仍受楼栋范围与状态约束） */
  roles: '*' | string[]
  resource: ResourceName
  /** 现有实现里的拦截位置（映射表与代码审查共用） */
  entry: string
  enforced: Enforcement
  /** 角色之外的附加条件，用一句话冻结（细节校验在 guard.ts） */
  extra: string
}

export const ACTION_RULES: Record<WriteAction, ActionRule> = {
  archive_write: {
    label: '维护档案（楼栋/楼层/测点/设备/基准）', roles: ['device', 'safety'], resource: 'archive',
    entry: 'stores/archive.ts 与各建档面板', enforced: 'open',
    extra: '基准改动必须写原因并按新版本落库，历史版本不覆盖',
  },
  record_write: {
    label: '录入监测记录（手录 / CSV 导入）', roles: '*', resource: 'record',
    entry: 'stores/records.addRecord / db 导入', enforced: 'open',
    extra: '补录按采样时间与录入时间之差判定并标注 isBackfill；人工检查点不产生数值记录',
  },
  record_revise: {
    label: '修订已入库记录', roles: '*', resource: 'record',
    entry: 'stores/records.reviseRecord', enforced: 'open',
    extra: '必须填写修订原因；修订历史与判定快照一起保留，不覆盖',
  },
  event_acknowledge: {
    label: '确认预警事件', roles: ['safety'], resource: 'event',
    entry: 'stores/events.acknowledgeEvent', enforced: 'store',
    extra: '事件必须处于"待确认"；确认同时把未确认通知一并标记',
  },
  event_close: {
    label: '关闭预警事件', roles: ['safety'], resource: 'event',
    entry: 'core/event/plan.closeGuard + closeBasis', enforced: 'store',
    extra: '仅"恢复待确认"可关闭；必须填关闭依据，且要有验收通过的关联工单或"无需维修"核查结论',
  },
  issue_report: {
    label: '上报问题（人工上报）', roles: '*', resource: 'issue',
    entry: 'stores/inspection/issues.reportManualIssue', enforced: 'open',
    extra: '任何身份可报（方案 §1）；照片按问题张数与体积上限校验',
  },
  issue_from_event: {
    label: '预警转问题', roles: ['safety'], resource: 'issue',
    entry: 'stores/inspection/issues.createIssueFromEvent', enforced: 'store',
    extra: '事件必须存在，且问题测点与事件测点一致',
  },
  issue_review: {
    label: '审核问题（六出口）', roles: ['safety'], resource: 'issue',
    entry: 'stores/inspection/issues.reviewIssue', enforced: 'store',
    extra: '六个一级出口之一 + 二级分类；"无需处理并关闭"必须写依据（≥10 字）',
  },
  issue_recheck_register: {
    label: '登记复查', roles: ['safety'], resource: 'issue',
    entry: 'stores/inspection/issueRecheck.registerRecheck', enforced: 'store',
    extra: '必须写复查事项、责任人与目标日期；工单验收通过后问题进入待复查时登记',
  },
  issue_recheck_outcome: {
    label: '提交复查结论', roles: ['safety'], resource: 'issue',
    entry: 'stores/inspection/issueRecheck.recordRecheckOutcome', enforced: 'store',
    extra: '三态之一；"继续观察"必须给下一次目标日期；逾期不会自动关闭',
  },
  work_order_dispatch: {
    label: '派工', roles: ['safety'], resource: 'workOrder',
    entry: 'core/inspection/workOrderFlow.advance', enforced: 'store',
    extra: '必须指定维修人；工单必须处于"待派工"',
  },
  work_order_accept: {
    label: '接单处理', roles: ['repair', 'property'], resource: 'workOrder',
    entry: 'core/inspection/workOrderFlow.advance', enforced: 'store',
    extra: '应为被派工人本人；物业值班可代接但必须写明代接原因',
  },
  work_order_submit: {
    label: '提交待验收', roles: ['repair', 'property'], resource: 'workOrder',
    entry: 'core/inspection/workOrderFlow.advance', enforced: 'store',
    extra: '必须填写维修措施；照片按完工照片上限校验',
  },
  work_order_verify: {
    label: '验收通过 / 退回', roles: ['safety'], resource: 'workOrder',
    entry: 'core/inspection/workOrderFlow.advance', enforced: 'store',
    extra: '退回必须写明原因；验收通过把问题推进到待复查，不自动关闭问题或事件',
  },
  inspection_checkin: {
    label: '到点签到', roles: '*', resource: 'task',
    entry: 'stores/inspection/taskWriteGuards.loadWriteContext', enforced: 'store',
    extra: '身份必须等于任务快照的执行角色；点位必须在本任务范围内；标签不符不得记为到达',
  },
  inspection_complete: {
    label: '完成检查 / 上报异常', roles: '*', resource: 'task',
    entry: 'stores/inspection/tasks.completePointCheck', enforced: 'store',
    extra: '必答项全部作答；异常项必须建问题或写明无需建单的依据',
  },
  maintenance_generate: {
    label: '生成保养任务', roles: ['safety', 'property'], resource: 'task',
    entry: 'stores/maintenance/tasks.generateForDay', enforced: 'store',
    extra: '同一计划同一执行时刻只有一条（业务键主键，并发点两次也只写一条）',
  },
  maintenance_execute: {
    label: '执行保养', roles: ['property', 'device', 'inspector'], resource: 'task',
    entry: 'core/maintenance/plan.ts 执行校验', enforced: 'store',
    extra: '应为计划负责人；物业值班可代执行但必须写明代执行原因；一个周期只执行一次',
  },
  attachment_upload: {
    label: '上传附件（照片）', roles: '*', resource: 'media',
    entry: 'db/inspection/attachments.savePhoto', enforced: 'ui-only',
    extra: '必须有且只有一个归属（问题 / 工单 / 保养任务）；按 draftId 去重，补传不重复入库',
  },
}

export function rolesOf(action: WriteAction): string[] | '*' {
  return ACTION_RULES[action].roles
}

/** 角色是否被允许；'*' 表示任意身份。 */
export function roleAllowed(action: WriteAction, roleKey: string): boolean {
  const roles = ACTION_RULES[action].roles
  return roles === '*' || roles.includes(roleKey)
}

/** 楼栋范围是否覆盖目标对象（`null` = 全校口径）。 */
export function scopeCovers(scope: ScopeRef, buildingId: string | null): boolean {
  return scopeAllowsBuilding(scope, buildingId)
}

/** 权限矩阵表（文档与测试共用一份，避免文档与代码各写一遍）。 */
export interface MatrixRow {
  action: WriteAction
  label: string
  roles: string
  resource: ResourceName
  enforced: Enforcement
  entry: string
  extra: string
}

export function permissionMatrix(): MatrixRow[] {
  return WRITE_ACTIONS.map((action) => {
    const rule = ACTION_RULES[action]
    return {
      action,
      label: rule.label,
      roles: rule.roles === '*' ? '任意身份' : rule.roles.join('、'),
      resource: rule.resource,
      enforced: rule.enforced,
      entry: rule.entry,
      extra: rule.extra,
    }
  })
}

/** 今天只在界面隐藏、下一步必须在服务端补拦的动作。 */
export function gapsToEnforce(): WriteAction[] {
  return WRITE_ACTIONS.filter((action) => ACTION_RULES[action].enforced !== 'store')
}
