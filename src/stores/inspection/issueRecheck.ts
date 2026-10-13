/**
 * 复查与观察期的写入路径（V1-C / V1-C.1）。
 *
 * 与 issueReview.ts 同一分工：业务写入与权限守在这里，store 只负责"调完重载"。
 * 三条口径：**必须登记**事项/责任人/目标日期；**结论由人明确选择**（系统不下结论）；
 * **逾期不自动关问题**。
 *
 * 关键纪律：**读问题 → 判定 → 写问题与审计日志必须在同一个 IndexedDB 事务里**。
 * 先在事务外读、再在事务内写的话，两次并发登记都会看到"尚未登记"，结果只剩一轮复查
 * 却留了两条"登记复查"日志；两次并发结论也会互相覆盖。
 * IndexedDB 对同一对象仓库的读写事务串行执行，第二个事务读到的必然是第一个提交后的状态。
 */
import { db } from '@/db/database'
import { nowIso } from '@/core/time'
import { buildAuditLog } from '@/db/repo'
import { toPlain } from '@/core/plain'
import { RECHECK_OUTCOMES, type InspectionIssue, type RecheckOutcome } from '@/types/inspection'
import { planRecheckOutcome, planRecheckRegister, roundsOf } from '@/core/inspection/recheck'
import { useSessionStore } from '../session'
import type { IssueActionResult } from './issues'

/// 复查结论要能回看"原问题、工单和事件"：按库里的编号拼一句引用说明（事务内读，故这几张表要在事务作用域里）。
async function referenceOf(issue: InspectionIssue): Promise<string> {
  const orders = issue.workOrderIds.length === 0 ? [] : await db.workOrders.bulkGet(issue.workOrderIds)
  const orderNos = orders.filter((row) => row !== undefined).map((row) => row.orderNo)
  const event = issue.eventId === null ? undefined : await db.events.get(issue.eventId)
  const parts = [
    orderNos.length === 0 ? '' : `原工单 ${orderNos.join('、')}`,
    event === undefined ? '' : `预警事件 ${event.eventNo}`,
  ].filter((part) => part !== '')
  return parts.join('、')
}

/**
 * 登记一轮复查（受控入口）：复查事项、责任人、目标日期一并落库，写时间线与操作日志。
 *
 * 权限沿用"督办在安全管理人员手上"的口径：登记与结论都限学校安全管理人员。
 * 责任人是登记字段（演示人员名单只用来减少输入，不代表权限），账号体系在 V2.0。
 */
export async function commitRecheckRegister(
  issueId: string,
  input: { subject: string; owner: string; dueDate: string },
): Promise<IssueActionResult> {
  const session = useSessionStore()
  if (session.role !== 'safety') {
    return { ok: false, error: '复查登记由学校安全管理人员执行', issue: null }
  }
  const at = nowIso()
  let saved: InspectionIssue | null = null
  let error = ''
  await db.transaction('rw', db.issues, db.audits, async () => {
    const issue = await db.issues.get(issueId)
    if (issue === undefined) {
      error = '问题不存在'
      return
    }
    const plan = planRecheckRegister({ issue, subject: input.subject, owner: input.owner, dueDate: input.dueDate, at, by: session.name })
    if (!plan.ok || plan.round === undefined) {
      error = plan.error
      return
    }
    const round = plan.round
    saved = {
      ...issue,
      rechecks: [...roundsOf(issue), round],
      updatedAt: at,
      updatedBy: session.name,
      timeline: [
        ...issue.timeline,
        {
          at,
          by: session.name,
          byRole: session.roleLabel,
          action: '登记复查',
          detail: `复查事项：${round.subject}；责任人：${round.owner}；目标日期：${round.dueDate}`,
        },
      ],
    }
    await db.issues.put(toPlain(saved))
    await db.audits.bulkPut(
      toPlain([
        buildAuditLog({
          actor: session.name,
          actorRole: session.roleLabel,
          action: 'update',
          objectType: 'system',
          objectId: saved.id,
          objectLabel: `${saved.issueNo} ${saved.anomalyType}`,
          summary: `登记复查：${saved.issueNo}（责任人 ${round.owner}，目标日期 ${round.dueDate}）`,
          reason: round.subject,
        }),
      ]),
    )
  })
  if (error !== '') return { ok: false, error, issue: null }
  return { ok: true, error: '', issue: saved }
}

/** 记录复查结论（受控入口）：确认恢复 / 继续观察 / 复发转处置。 */
export async function commitRecheckOutcome(
  issueId: string,
  input: { outcome: RecheckOutcome; note: string; nextDueDate?: string },
): Promise<IssueActionResult> {
  const session = useSessionStore()
  if (session.role !== 'safety') {
    return { ok: false, error: '复查结论由学校安全管理人员执行', issue: null }
  }
  const at = nowIso()
  let saved: InspectionIssue | null = null
  let error = ''
  await db.transaction('rw', db.issues, db.audits, db.workOrders, db.events, async () => {
    const issue = await db.issues.get(issueId)
    if (issue === undefined) {
      error = '问题不存在'
      return
    }
    const plan = planRecheckOutcome({
      issue,
      outcome: input.outcome,
      note: input.note,
      nextDueDate: input.nextDueDate,
      reference: await referenceOf(issue),
      at,
      by: session.name,
      byRole: session.roleLabel,
    })
    if (!plan.ok || plan.next === undefined) {
      error = plan.error
      return
    }
    saved = plan.next
    const label = RECHECK_OUTCOMES.find((row) => row.key === input.outcome)?.name ?? input.outcome
    await db.issues.put(toPlain(saved))
    await db.audits.bulkPut(
      toPlain([
        buildAuditLog({
          actor: session.name,
          actorRole: session.roleLabel,
          action: 'update',
          objectType: 'system',
          objectId: saved.id,
          objectLabel: `${saved.issueNo} ${saved.anomalyType}`,
          summary: `问题 ${saved.issueNo}：复查结论 ${label}`,
          reason: input.note,
        }),
      ]),
    )
  })
  if (error !== '') return { ok: false, error, issue: null }
  return { ok: true, error: '', issue: saved }
}
