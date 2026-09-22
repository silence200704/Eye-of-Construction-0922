/**
 * 巡检计划 → 任务生成（纯函数）。
 *
 * 方案 §3：点检按设备生成检查清单，巡检按路线设置必查点；
 * 人员领取任务后逐个点位到点检查，**未检查的点始终留在待检查**，不因任务提交变完成。
 * 这里只做"计划按周期展开成哪些任务、每个任务该查哪些点、任务整体算完成到哪一步"，
 * 写库与页面交互在 stores / views 里。
 */
import type { InspectionPlan, InspectionTask, PlanCycle, TaskCheckResult, TaskPlanSnapshot, TaskStatus } from '@/types/inspection'
import type { Floor, Point } from '@/types/domain'

/**
 * 当日截止时刻（本地 23:59:59）。
 * 计划时刻是"该在什么时候去查"，截止时刻是"当天过完还没查才算逾期"——
 * 拿计划时刻当截止，上午刚生成的任务下午就会显示逾期，那是错的。
 */
export function endOfDayOf(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 0)
}

/** 本地日期键 YYYYMMDD，与编号规则共用。 */
export function dayKeyOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function atTimeOn(date: Date, atTime: string): Date {
  const [hour, minute] = atTime.split(':').map((part) => Number.parseInt(part, 10))
  const out = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0, 0, 0)
  return out
}

/** 周期是否命中某一天：按天/周/月的间隔从起始日推算。 */
export function cycleHits(cycle: PlanCycle, startDate: Date, day: Date): boolean {
  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
  const target = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  if (target.getTime() < start.getTime()) return false
  const step = Math.max(1, Math.floor(cycle.interval))
  const dayMs = 86_400_000
  const diffDays = Math.round((target.getTime() - start.getTime()) / dayMs)
  if (cycle.unit === 'day') return diffDays % step === 0
  if (cycle.unit === 'week') return diffDays % (7 * step) === 0
  /*
   * 月：按自然月差判断，避免月末天数不一致带来的漂移。
   * 起始日的"日"超出当月天数时取当月最后一天（起始日 31 日在 2 月落到 28/29 日），
   * 否则二月会整月不生成任务。
   */
  const months = (target.getFullYear() - start.getFullYear()) * 12 + (target.getMonth() - start.getMonth())
  return target.getDate() === hitDayOfMonth(start.getDate(), target) && months % step === 0
}

/** 某月的命中日：起始日超出当月天数时用当月最后一天。 */
export function hitDayOfMonth(startDay: number, day: Date): number {
  const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate()
  return Math.min(startDay, lastDay)
}

/** 计划在某一天应生成的任务时刻；不命中返回 null。 */
export function plannedAtOf(plan: InspectionPlan, day: Date): Date | null {
  const start = new Date(`${plan.startDate}T00:00:00`)
  if (!Number.isFinite(start.getTime())) return null
  const end = plan.endDate === null ? null : new Date(`${plan.endDate}T23:59:59`)
  if (end !== null && day.getTime() > end.getTime()) return null
  if (!cycleHits(plan.cycle, start, day)) return null
  return atTimeOn(day, plan.cycle.atTime)
}

/** 计划快照：任务生成时写入，之后计划改动不影响既有任务。 */
export function snapshotOfPlan(plan: InspectionPlan): TaskPlanSnapshot {
  return {
    planCode: plan.code,
    planName: plan.name,
    executorRole: plan.executorRole,
    buildingId: plan.buildingId,
    floorIds: [...plan.floorIds],
    pointIds: [...plan.pointIds],
    checklist: plan.checklist.map((item) => ({ ...item })),
  }
}

/** 任务对应的检查点位：点检按设备所在测点，巡检按路线必查点；两者都取计划里登记的点位。 */
export function taskPointIds(plan: InspectionPlan): string[] {
  return [...plan.pointIds]
}

/** 新建任务时的逐点初始结果：全部待检查。点位与清单都取自快照，不再读当前计划。 */
export function initialResults(snapshot: TaskPlanSnapshot): TaskCheckResult[] {
  const checklist = snapshot.checklist
  return snapshot.pointIds.map((pointId) => ({
    pointId,
    status: 'pending',
    checkedAt: null,
    method: null,
    labelRead: '',
    labelExpected: '',
    labelVersion: null,
    fallbackReason: '',
    attempts: [],
    checklist: checklist.map((item) => ({ key: item.key, label: item.label, result: null, note: '' })),
    abnormalHandling: { linkedIssueId: null, reason: '' },
    issueIds: [],
  }))
}

/**
 * 任务整体状态：全部点"检查完成"→ 已检查；完成了一部分 → 部分完成；一个都没完成 → 待检查。
 * 只到点但没填清单的点不计入完成（方案 §3：错点不得计入完成；评审补充：到点不等于查完）。
 */
export function taskStatusOf(results: TaskCheckResult[]): TaskStatus {
  if (results.length === 0) return 'pending'
  const completed = results.filter((row) => row.status === 'completed').length
  if (completed === 0) return 'pending'
  return completed === results.length ? 'checked' : 'partial'
}

/** 该任务的检查覆盖率，用于列表上显示"3 / 5 点"。 */
export function taskProgress(results: TaskCheckResult[]): { completed: number; total: number; percent: number } {
  const total = results.length
  const completed = results.filter((row) => row.status === 'completed').length
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) }
}

/** 逾期未检：计划时刻已过且仍有点未检查。 */
export function isOverdue(task: InspectionTask, now: Date): boolean {
  if (task.status === 'checked') return false
  return new Date(task.dueAt).getTime() < now.getTime()
}

/* ---------------- 计划校验与任务生成（幂等） ---------------- */

export interface PlanDraftCheck {
  ok: boolean
  errors: string[]
}

/**
 * 必查点列表为空时的说明。
 *
 * 原来只有一句"先勾选楼层，再选必查点"，于是"楼层已勾选、但该楼层下确实没有在册测点"这种情况
 * 会给出一个用户已经做完的指令：看起来像点不动，实际是没得选，而且不告诉他哪里有测点 ——
 * 现场就是这么卡住建不了计划的。三种原因分开说，数据故障还要能指到检查入口。
 */
export function pointPoolHint(input: {
  selectedFloorIds: string[]
  /** 所选楼栋的在册测点（页面已按 status=active 与 buildingId 过滤） */
  buildingPoints: Point[]
  /** 所选楼栋现有的楼层 id 集合，用于识别"测点指向的楼层不存在" */
  buildingFloorIds: ReadonlySet<string>
  floorNameOf: (floorId: string) => string
}): string {
  if (input.selectedFloorIds.length === 0) return '先勾选楼层，再选必查点'
  // 有可选测点时不需要说明（页面据此不渲染）
  if (input.buildingPoints.some((row) => input.selectedFloorIds.includes(row.floorId))) return ''
  const orphans = input.buildingPoints.filter((row) => !input.buildingFloorIds.has(row.floorId))
  if (orphans.length > 0) {
    return `本楼栋有 ${orphans.length} 个测点的楼层引用已失效（${orphans
      .map((row) => row.code)
      .join('、')}）；请到「系统设置 → 数据一致性检查」查看后再建档`
  }
  if (input.buildingPoints.length === 0) {
    return '所选楼层下没有在册测点：本楼栋还没有测点档案，请先到「建筑与设备」给测点建档'
  }
  const elsewhere = [...new Set(input.buildingPoints.map((row) => input.floorNameOf(row.floorId)))]
  return `所选楼层下没有在册测点：本楼栋的测点记录在 ${elsewhere.join('、')}，请勾选对应楼层`
}

/**
 * 建计划时的归属校验：楼栋存在、楼层属于该楼栋、必查点落在这些楼层里。
 * 归属不一致的计划生成出来的任务会指向别的楼栋，现场到点就对不上。
 */
export function validatePlan(
  plan: Pick<InspectionPlan, 'buildingId' | 'floorIds' | 'pointIds' | 'cycle' | 'startDate' | 'pointIds' | 'name'>,
  ctx: { buildings: { id: string }[]; floors: Floor[]; points: Point[] },
): PlanDraftCheck {
  const errors: string[] = []
  if (plan.name.trim() === '') errors.push('计划名称必填')
  if (plan.startDate.trim() === '') errors.push('开始日期必填')
  if (plan.cycle.interval < 1) errors.push('周期间隔至少为 1')
  if (plan.floorIds.length === 0) errors.push('至少要选择一个楼层')
  if (plan.pointIds.length === 0) errors.push('至少要选择一个必查点')

  if (!ctx.buildings.some((row) => row.id === plan.buildingId)) {
    errors.push('所属楼栋不存在')
    return { ok: errors.length === 0, errors }
  }
  const floorsOfBuilding = ctx.floors.filter((row) => row.buildingId === plan.buildingId && row.status === 'active')
  for (const floorId of plan.floorIds) {
    if (!floorsOfBuilding.some((row) => row.id === floorId)) {
      errors.push(`楼层 ${floorId} 不属于该楼栋或已归档`)
    }
  }
  const floorIds = new Set(plan.floorIds)
  for (const pointId of plan.pointIds) {
    const point = ctx.points.find((row) => row.id === pointId)
    if (point === undefined) {
      errors.push(`必查点 ${pointId} 不存在`)
      continue
    }
    if (point.status !== 'active') {
      errors.push(`必查点 ${point.code} 已归档，不能排进新计划`)
      continue
    }
    if (point.buildingId !== plan.buildingId || !floorIds.has(point.floorId)) {
      errors.push(`必查点 ${point.code} 不在所选楼栋/楼层范围内`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** 任务唯一键：同一计划、同一执行时刻只允许一条任务，重复点"生成今日任务"不会重复建单。 */
export function taskKeyOf(planId: string, plannedAt: string): string {
  return `${planId}@${plannedAt}`
}

export interface PlannedTask {
  plan: InspectionPlan
  /** 生成时的计划快照：任务范围、归属与清单以它为准 */
  snapshot: TaskPlanSnapshot
  plannedAt: string
  dueAt: string
  pointIds: string[]
}

/**
 * 当天"应做"的任务（纯函数）。
 *
 * 只按计划与周期判断（启用中、命中当天、有必查点），**不看是否已经生成过**：
 * "该不该新建"必须由数据库在写入事务里回答，否则并发双击时两个调用都会
 * 拿内存里的旧快照判断"尚不存在"，于是各写一条。这里只回答"今天理论上要做哪些"。
 */
export function planTasksFor(plans: InspectionPlan[], day: Date): PlannedTask[] {
  const out: PlannedTask[] = []
  for (const plan of plans) {
    if (!plan.enabled) continue
    const planned = plannedAtOf(plan, day)
    if (planned === null) continue
    const plannedAt = planned.toISOString()
    const pointIds = taskPointIds(plan)
    if (pointIds.length === 0) continue
    out.push({
      plan,
      snapshot: snapshotOfPlan(plan),
      plannedAt,
      dueAt: endOfDayOf(planned).toISOString(),
      pointIds,
    })
  }
  return out
}

/** 任务里所有已提交的问题编号（含各点）。 */
export function taskIssueIds(task: InspectionTask): string[] {
  const ids = new Set<string>(task.issueIds)
  for (const row of task.results) for (const id of row.issueIds) ids.add(id)
  return [...ids]
}
