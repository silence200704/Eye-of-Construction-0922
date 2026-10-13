/**
 * 复查与观察期（纯函数）。
 *
 * 方案 §4：工单验收通过只把问题推进到"待复查"，之后要有人按期复查并给出结论。
 * 三条硬口径都在这里落地：
 * - **必须登记**：复查事项、责任人、目标日期缺一不可，且只有"待复查 / 观察中"的问题可以登记；
 * - **系统不替人下结论**：确认恢复 / 继续观察 / 复发转处置三种由复查人明确选择；
 * - **逾期不自动关问题**：到期未复查只是进入待办并标出逾期天数，状态与结论一概不动。
 */
import type { InspectionIssue, RecheckOutcome, RecheckRound } from '@/types/inspection'
import { RECHECK_OUTCOMES } from '@/types/inspection'
import { isValidDayKey } from '@/core/time'

/** 复查事项与结论说明的最少字数：太短等于没写，事后解释不了。 */
export const RECHECK_MIN_LENGTH = 4

/** 可以登记复查 / 出结论的状态：验收后是待复查，继续观察时是观察中。 */
const OPEN_STATUSES: InspectionIssue['status'][] = ['pending_recheck', 'observing']

export interface RecheckState {
  /** none=不需要复查；awaiting=已登记未到期；due=今天到期；overdue=已逾期 */
  state: 'none' | 'awaiting' | 'due' | 'overdue'
  /** 逾期天数（未逾期为 0） */
  overdueDays: number
  /** 距离目标日期还有几天（逾期或无目标为 0） */
  remainingDays: number
  round?: RecheckRound
}

/** 复查轮次（旧数据没有该字段时按空数组处理）。 */
export function roundsOf(issue: InspectionIssue): RecheckRound[] {
  return issue.rechecks ?? []
}

/** 当前未结的一轮（最后一轮且还没有结论）。 */
export function activeRound(issue: InspectionIssue): RecheckRound | undefined {
  const rounds = roundsOf(issue)
  const last = rounds[rounds.length - 1]
  return last !== undefined && last.outcome === null ? last : undefined
}

/** 是否需要复查（状态在复查链条上）。 */
export function needsRecheck(issue: InspectionIssue): boolean {
  return OPEN_STATUSES.includes(issue.status)
}

function dayNumber(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return Number.NaN
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

/**
 * 复查到期状态。`todayKey` 传本地日期（YYYY-MM-DD），由调用方给 —— 纯函数不读时钟。
 */
export function recheckState(issue: InspectionIssue, todayKey: string): RecheckState {
  const round = activeRound(issue)
  if (!needsRecheck(issue) || round === undefined) return { state: 'none', overdueDays: 0, remainingDays: 0 }
  const due = dayNumber(round.dueDate)
  const today = dayNumber(todayKey)
  if (!Number.isFinite(due) || !Number.isFinite(today)) return { state: 'awaiting', overdueDays: 0, remainingDays: 0, round }
  const gap = due - today
  if (gap < 0) return { state: 'overdue', overdueDays: -gap, remainingDays: 0, round }
  return { state: gap === 0 ? 'due' : 'awaiting', overdueDays: 0, remainingDays: gap, round }
}

export interface RecheckPlan {
  ok: boolean
  error: string
  /** 登记成功时返回新的一轮（由调用方并进问题行） */
  round?: RecheckRound
  /** 出结论成功时的下一版问题行 */
  next?: InspectionIssue
}

/** 登记一轮复查：事项、责任人、目标日期都必填。 */
export function planRecheckRegister(
  input: { issue: InspectionIssue; subject: string; owner: string; dueDate: string; at: string; by: string },
): RecheckPlan {
  const { issue } = input
  if (!needsRecheck(issue)) {
    return { ok: false, error: '只有"待复查 / 观察中"的问题需要登记复查' }
  }
  if (activeRound(issue) !== undefined) {
    return { ok: false, error: '已有一轮复查未出结论，请先记录复查结论再登记下一轮' }
  }
  const subject = input.subject.trim()
  const owner = input.owner.trim()
  const dueDate = input.dueDate.trim()
  if (subject.length < RECHECK_MIN_LENGTH) {
    return { ok: false, error: `请写明要复查什么（不少于 ${RECHECK_MIN_LENGTH} 个字），否则到场不知道查什么` }
  }
  if (owner === '') return { ok: false, error: '必须指定复查责任人，否则逾期了没人负责' }
  if (dueDate === '') return { ok: false, error: '必须填写复查目标日期，否则无法进入待办与统计' }
  if (!isValidDayKey(dueDate)) return { ok: false, error: '复查目标日期不是合法日期（需形如 2026-09-25，且日历上真实存在）' }
  return {
    ok: true,
    error: '',
    round: { subject, owner, dueDate, at: input.at, by: input.by, outcome: null, outcomeAt: null, outcomeBy: '', outcomeNote: '' },
  }
}

/** 复查结论 → 问题状态。出口与状态一一对应，不做自由跳转。 */
const OUTCOME_STATUS: Record<RecheckOutcome, InspectionIssue['status']> = {
  recovered: 'closed',
  observing: 'observing',
  recurred: 'pending_review',
}

export interface OutcomeInput {
  issue: InspectionIssue
  outcome: RecheckOutcome
  note: string
  /**
   * 「继续观察」时必须给：下一轮复查的目标日期。
   * 其余结论忽略该字段。
   */
  nextDueDate?: string
  /** 原工单与预警事件的引用说明（由调用方按库里的编号拼好），写进时间线便于回看 */
  reference?: string
  at: string
  by: string
  byRole: string
}

/** 记录复查结论：确认恢复→关闭、继续观察→观察中（并开下一轮）、复发→退回待审核。 */
export function planRecheckOutcome(input: OutcomeInput): RecheckPlan {
  const { issue } = input
  const round = activeRound(issue)
  if (!needsRecheck(issue) || round === undefined) {
    return { ok: false, error: '当前没有待出结论的复查轮次：请先登记复查事项与目标日期' }
  }
  const note = input.note.trim()
  if (note.length < RECHECK_MIN_LENGTH) {
    return { ok: false, error: `复查结论要写明依据（不少于 ${RECHECK_MIN_LENGTH} 个字），否则等于没复查` }
  }
  const label = RECHECK_OUTCOMES.find((row) => row.key === input.outcome)?.name ?? input.outcome
  const nextDueDate = (input.nextDueDate ?? '').trim()
  if (input.outcome === 'observing' && nextDueDate === '') {
    return { ok: false, error: '「继续观察」必须登记下一次复查的目标日期，否则观察期没有尽头' }
  }
  if (input.outcome === 'observing' && !isValidDayKey(nextDueDate)) {
    return { ok: false, error: '下一次复查日期不是合法日期（需形如 2026-10-05，且日历上真实存在）' }
  }

  const rounds = roundsOf(issue)
  const closed: RecheckRound = {
    ...round,
    outcome: input.outcome,
    outcomeAt: input.at,
    outcomeBy: input.by,
    outcomeNote: note,
  }
  const nextRounds: RecheckRound[] =
    input.outcome === 'observing'
      ? [
          ...rounds.slice(0, -1),
          closed,
          {
            subject: `观察期复查：${round.subject}`,
            owner: round.owner,
            dueDate: nextDueDate,
            at: input.at,
            by: input.by,
            outcome: null,
            outcomeAt: null,
            outcomeBy: '',
            outcomeNote: '',
          },
        ]
      : [...rounds.slice(0, -1), closed]

  const tail: Record<RecheckOutcome, string> = {
    recovered: '问题转入已关闭；原工单与预警事件仍可回看（事件关闭另有条件，不随本结论自动关闭）',
    observing: `进入观察期，下一次复查目标日期 ${nextDueDate}`,
    recurred: '退回待审核重新安排处置：原问题、原工单与预警事件继续沿用，不新建无关问题',
  }
  const reference = (input.reference ?? '').trim()
  return {
    ok: true,
    error: '',
    next: {
      ...issue,
      status: OUTCOME_STATUS[input.outcome],
      rechecks: nextRounds,
      updatedAt: input.at,
      updatedBy: input.by,
      timeline: [
        ...issue.timeline,
        {
          at: input.at,
          by: input.by,
          byRole: input.byRole,
          action: `复查：${label}`,
          detail: `${note}｜${tail[input.outcome]}${reference === '' ? '' : `｜${reference}`}`,
        },
      ],
    },
  }
}
