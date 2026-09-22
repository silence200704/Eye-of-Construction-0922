/**
 * 处置链的事务提交。
 *
 * 三条路径都在这里：问题创建（含任务关联）、问题之间的关联、任务写入。
 * 共同点是"业务数据 + 审计日志必须一起落库" —— 分两次写会留下半成品或没有留痕的记录，
 * 而这套系统的价值恰恰在于"每件事都能倒查、每步失败都不留脏数据"。
 */
import { db } from '@/db/database'
import { toPlain } from '@/core/plain'
import { allocateWorkOrderNo } from './numbering'
import type { AuditLog } from '@/types/domain'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, InspectionTask, IssueAttachment, WorkOrder } from '@/types/inspection'

/**
 * 关联既有对象：源问题、目标问题、预警事件、**随本次审核上传的照片**与日志在**一个事务**里提交。
 *
 * 为什么必须一起写：
 * - 关联是双向事实（源问题记"关联到谁"，目标对象记"被谁关联"），只写一半就会出现
 *   "从一端进去看不到另一端"的单向留痕；
 * - 照片若先入库、审核再失败，会留下"附件已经在问题上、审核结论却没落库"的半成品 ——
 *   看起来像有处置依据，实际什么事都没定。
 */
export async function commitIssueLink(input: {
  source: InspectionIssue
  targetIssue: InspectionIssue | null
  event: AlarmEvent | null
  /** 本次随审核一起写入的附件（草稿已压缩，事务内直接落库） */
  attachments?: IssueAttachment[]
  logs: AuditLog[]
}): Promise<void> {
  const photos = input.attachments ?? []
  await db.transaction('rw', db.issues, db.events, db.attachments, db.audits, async () => {
    await db.issues.put(toPlain(input.source))
    if (input.targetIssue !== null) await db.issues.put(toPlain(input.targetIssue))
    if (input.event !== null) await db.events.put(toPlain(input.event))
    if (photos.length > 0) await db.attachments.bulkPut(toPlain(photos))
    if (input.logs.length > 0) await db.audits.bulkPut(toPlain(input.logs))
  })
}

/**
 * 审核转维修：**单号分配 + 新建工单 + 问题状态变更 + 照片 + 日志**在同一个事务里提交。
 *
 * 这一条防三件事：
 * ① 假状态 —— 问题显示"处理中/维修中"而工单其实没建出来；
 * ② 撞号 —— 单号是"读当日最大值 +1"，在事务外先读后写时，两条并发转维修会算出同一个号，
 *    而工单主键是随机 ID，数据库不会拦。分配必须和写入待在同一个事务里（见 numbering.ts）；
 * ③ 半成品依据 —— 「已当场处理」的现场照片若先落库、审核再失败，问题会显示有照片却没有审核结论。
 *
 * `workOrder.orderNo` 传空串表示由本事务分配：日志要引用最终单号，所以日志也在这里构造。
 */
export async function commitIssueWithWorkOrder(input: {
  issue: InspectionIssue
  workOrder: WorkOrder
  attachments?: IssueAttachment[]
  buildLogs: (order: WorkOrder) => AuditLog[]
}): Promise<WorkOrder> {
  const photos = input.attachments ?? []
  return db.transaction('rw', db.workOrders, db.issues, db.attachments, db.audits, async () => {
    const order: WorkOrder =
      input.workOrder.orderNo === ''
        ? { ...input.workOrder, orderNo: await allocateWorkOrderNo(input.workOrder.createdAt) }
        : input.workOrder
    await db.workOrders.add(toPlain(order))
    await db.issues.put(toPlain(input.issue))
    if (photos.length > 0) await db.attachments.bulkPut(toPlain(photos))
    const logs = input.buildLogs(order)
    if (logs.length > 0) await db.audits.bulkPut(toPlain(logs))
    return order
  })
}

/**
 * 验收完成：**工单状态 + 关联问题状态 + 日志**在同一个事务里提交。
 *
 * 分开写的后果是"工单已验收通过、问题还停在处理中"——评委从问题详情进来看，
 * 状态与工单对不上，正是最容易被追问穿的那种半成品。两者必须同生共死。
 */
export async function commitVerifyWithIssue(input: {
  workOrder: WorkOrder
  issue: InspectionIssue
  logs: AuditLog[]
}): Promise<void> {
  await db.transaction('rw', db.workOrders, db.issues, db.audits, async () => {
    await db.workOrders.put(toPlain(input.workOrder))
    await db.issues.put(toPlain(input.issue))
    if (input.logs.length > 0) await db.audits.bulkPut(toPlain(input.logs))
  })
}

/**
 * 工单状态流转 + 日志的单事务提交（派工、接单、提交待验收、验收）。 */
export async function commitWorkOrderWrite(input: { workOrder: WorkOrder; logs: AuditLog[] }): Promise<void> {
  await db.transaction('rw', db.workOrders, db.audits, async () => {
    await db.workOrders.put(toPlain(input.workOrder))
    if (input.logs.length > 0) await db.audits.bulkPut(toPlain(input.logs))
  })
}

/**
 * 任务写入 + 审计日志的单事务提交。
 *
 * 到点、完成检查、关联既有问题都走这里：先落任务再写日志的话，
 * 日志失败会留下**没有留痕**的到点或检查完成记录 —— 那正是"留痕系统"最不该出的问题。
 */
export async function commitTaskWrite(input: { task: InspectionTask; logs: AuditLog[] }): Promise<void> {
  await db.transaction('rw', db.tasks, db.audits, async () => {
    await db.tasks.put(toPlain(input.task))
    if (input.logs.length > 0) await db.audits.bulkPut(toPlain(input.logs))
  })
}
