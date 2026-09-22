/**
 * 业务编号的**事务内分配**。
 *
 * 为什么必须放进事务：编号是"读当日最大值 + 1"，先读后写之间只要有人插进来就会撞号。
 * 问题表靠"提交标识 → 确定性主键"天然防重，工单表没有这层保护 —— 主键是随机 ID，
 * 两条并发转维修会安安稳稳地各写一行 `WO-20260920-001`，数据库不会拦。
 *
 * 为什么放进事务就安全：IndexedDB 对**同一对象仓库**的读写事务串行执行，
 * 第二个事务读到的必然是第一个提交后的最大值。因此调用方必须把本函数放在
 * 覆盖对应表的事务里调用（`createIssueAtomic` / `commitIssueWithWorkOrder` 都这么做），
 * 在事务外调用等于没修。
 */
import { db } from '@/db/database'
import { isoDayKey, nextIssueNo, nextWorkOrderNo } from '@/core/id'

/** 事务内分配问题编号 ISS-YYYYMMDD-001。 */
export async function allocateIssueNo(at: string): Promise<string> {
  const rows = await db.issues.toArray()
  return nextIssueNo(isoDayKey(at), rows.map((row) => row.issueNo))
}

/** 事务内分配工单编号 WO-YYYYMMDD-001。 */
export async function allocateWorkOrderNo(at: string): Promise<string> {
  const rows = await db.workOrders.toArray()
  return nextWorkOrderNo(isoDayKey(at), rows.map((row) => row.orderNo))
}
