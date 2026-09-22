/**
 * 标签编号全校唯一性校验。
 *
 * 一个标签编号只能绑在一个活动测点上：否则两个任务都可能拿同一张卡判成"到点"，
 * 到点证明就失去意义。换绑时排除自己（同一个点位改编号是允许的）。
 */
export function labelConflict(
  points: Point[],
  code: string,
  exceptPointId: string | null,
): { pointId: string; pointCode: string; pointName: string } | null {
  const target = code.trim()
  if (target === '') return null
  for (const point of points) {
    if (point.id === exceptPointId) continue
    if (point.status !== 'active') continue
    if (point.nfc?.code.trim() === target) {
      return { pointId: point.id, pointCode: point.code, pointName: point.name }
    }
  }
  return null
}

/** 校验标签格式：与测点编号同源的 NFC- 前缀，便于现场核对；只做提示级约束，不强制。 */
export function labelFormatHint(code: string, pointCode: string): string {
  const target = code.trim()
  if (target === '') return '留空表示暂不绑定标签，打卡时只能走人工兜底'
  if (target.toUpperCase().startsWith('NFC-')) return ''
  return `建议使用 NFC- 前缀（例如 NFC-${pointCode}），现场核对时更容易看出是哪个点`
}

/**
 * 到点打卡判定（纯函数）。
 *
 * 方案 §3 的口径：
 * - 人员领取任务后手动选择点位，或点击模拟读卡带入编号；记录入口方式、标签版本、任务和操作者；
 * - **错点不得计入完成**：读到的编号与点位登记的编号不一致时，只生成失败留痕，点位仍留在待检查；
 * - 读取失败可人工输入编号并填写原因，但要记为"人工兜底签到"，且**模拟读卡不构成真实到场证明**。
 */
import type { Point } from '@/types/domain'
import type { CheckInAttempt, CheckMethod, ChecklistAnswer, TaskCheckResult } from '@/types/inspection'

export interface CheckInInput {
  /** 当次读到的标签编号（模拟读卡或人工输入） */
  labelRead: string
  method: CheckMethod
  /** 人工兜底时必须填写原因；留空即不通过 */
  fallbackReason: string
  /** 该点位档案上的登记标签 */
  point: Point
  at: string
}

export interface CheckInOutcome {
  /** 通过 = 到点成立（进入"已到点，待检查"），不表示检查完成 */
  passed: boolean
  /** 标签版本：通过时取登记版本，不通过为 null（读到的不是这个点的标签） */
  labelVersion: number | null
  message: string
}

/**
 * 到点判定。人工兜底必须在原因里说明为什么没能读卡，否则不通过。
 *
 * 注意：通过只代表"到点"，检查完成还要等必答清单回答完（见 completeCheck）。
 */
export function checkIn(input: CheckInInput): CheckInOutcome {
  const read = input.labelRead.trim()
  const expected = input.point.nfc?.code ?? ''
  const expectedVersion = input.point.nfc?.version ?? null

  if (read === '') {
    return { passed: false, labelVersion: null, message: '未提供标签编号，点位仍为待到点' }
  }
  if (expected === '') {
    return {
      passed: false,
      labelVersion: null,
      message: '该点位未登记 NFC 标签，无法核对编号；请先在档案里登记标签，或走人工兜底并说明原因',
    }
  }
  if (read !== expected) {
    return {
      passed: false,
      labelVersion: null,
      message: `标签编号不一致：读到 ${read}，该点位登记为 ${expected}。错点不计入到点，已留痕`,
    }
  }
  if (input.method === 'manual' && input.fallbackReason.trim() === '') {
    return {
      passed: false,
      labelVersion: null,
      message: '人工兜底签到必须填写原因（例如读卡失败、标签损坏），否则不予到点',
    }
  }
  const via = input.method === 'nfc' ? '模拟读卡' : '人工兜底'
  return { passed: true, labelVersion: expectedVersion, message: `${via}核对通过（标签 ${expected} v${expectedVersion ?? 1}）` }
}

/**
 * 把一次尝试写回点位的检查结果。
 *
 * 三条不可退让的规则：
 * ① 失败的尝试只追加留痕，**不改动**已有的到点时间与状态（扫错卡不能把已完成的点退回待检查）；
 * ② 通过时才把状态推进到"已到点，待检查"（已完成的保持完成，不因重新打卡而回退）；
 * ③ 尝试历史只追加不覆盖，事后能看出当时扫的是哪张卡。
 */
export function applyCheckIn(result: TaskCheckResult, input: CheckInInput): TaskCheckResult {
  const outcome = checkIn(input)
  const attempt: CheckInAttempt = {
    at: input.at,
    method: input.method,
    labelRead: input.labelRead.trim(),
    labelExpected: input.point.nfc?.code ?? '',
    labelVersion: outcome.labelVersion,
    fallbackReason: input.fallbackReason.trim(),
    passed: outcome.passed,
    message: outcome.message,
  }
  const next: TaskCheckResult = {
    ...result,
    attempts: [...result.attempts, attempt],
  }
  if (!outcome.passed) return next
  return {
    ...next,
    status: result.status === 'completed' ? 'completed' : 'arrived',
    checkedAt: result.checkedAt ?? input.at,
    method: input.method,
    labelRead: attempt.labelRead,
    labelExpected: attempt.labelExpected,
    labelVersion: outcome.labelVersion,
    fallbackReason: attempt.fallbackReason,
  }
}

export interface CompleteInput {
  result: TaskCheckResult
  answers: ChecklistAnswer[]
  /** 必答清单项（来自任务快照） */
  requiredKeys: string[]
  /** 清单出现异常时的处置：关联的问题 ID 与无需建问题的依据 */
  abnormalHandling: { linkedIssueId: string | null; reason: string }
  /**
   * 该问题是否真实存在且属于本任务与点位 —— 由仓储查库后传入。
   * 纯函数不查库，但也不接受页面自己勾一个布尔值充当证据。
   */
  issueValid: boolean
  at: string
}

export interface CompleteOutcome {
  ok: boolean
  error: string
  next: TaskCheckResult | null
}

/**
 * 提交"检查完成"。
 * 前置：已到点；必答清单全部作答；出现异常时必须建了问题或写明无需建问题的依据。
 */
export function completeCheck(input: CompleteInput): CompleteOutcome {
  const { result } = input
  if (result.status === 'pending') {
    return { ok: false, error: '尚未到点，不能提交检查完成；请先模拟读卡或走人工兜底签到', next: null }
  }
  if (result.status === 'completed') {
    return { ok: false, error: '该点位的检查已完成，如需更正请走记录修订', next: null }
  }

  const answered = new Map(input.answers.map((row) => [row.key, row]))
  const missing = input.requiredKeys.filter((key) => {
    const row = answered.get(key)
    return row === undefined || row.result === null
  })
  if (missing.length > 0) {
    return { ok: false, error: `还有 ${missing.length} 个必答检查项没有作答，不能提交为检查完成`, next: null }
  }

  const abnormal = input.answers.filter((row) => row.result === 'abnormal')
  if (abnormal.length > 0 && !input.issueValid && input.abnormalHandling.reason.trim().length < 10) {
    return {
      ok: false,
      error: '检查项出现异常：请创建巡检问题并关联到本点位，或写明"无需建问题"的依据（不少于 10 个字）',
      next: null,
    }
  }

  return {
    ok: true,
    error: '',
    next: {
      ...result,
      status: 'completed',
      checklist: input.answers.map((row) => ({ ...row })),
      abnormalHandling: {
        linkedIssueId: input.issueValid ? input.abnormalHandling.linkedIssueId : null,
        reason: input.abnormalHandling.reason.trim(),
      },
    },
  }
}

/** 换绑标签：版本递增并记录新编号，历史打卡记录里的旧编号与版本不动。 */
export function rebindLabel(point: Point, code: string, at: string, by: string, remark: string): Point {
  const version = (point.nfc?.version ?? 0) + 1
  return {
    ...point,
    nfc: { code: code.trim(), version, boundAt: at, boundBy: by, remark },
  }
}

/** 界面上必须写明的口径说明：纯前端阶段读卡是模拟的。 */
export const NFC_DISCLAIMER = '模拟 NFC 读取：编号由页面带入或人工输入，仅用于演示到点核对，不构成真实到场证明'
