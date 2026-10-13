/**
 * 明细 CSV 导出（V1-E）。
 *
 * 口径：导出**当前筛选条件下的明细行**，不是另算一份统计 —— 页面上看到多少条，CSV 里就多少条，
 * 每行都带业务编号，能回到系统里核对。列名写中文，方便直接给管理人员看。
 */
import { toCsv } from '@/core/csv'
import { formatDateTime } from '@/core/time'
import { EVENT_LEVEL_LABEL, EVENT_STATUS_LABEL } from '@/types/events'
import { ISSUE_SOURCES, ISSUE_STATUSES } from '@/types/inspection'
import type { AlarmEvent } from '@/types/events'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'

/** 楼栋/测点名称解析：由页面传进来，导出模块不查库。 */
export interface NameResolvers {
  point: (pointId: string | null) => string
  building: (buildingId: string) => string
  /** 事件只带测点，要按测点反查楼栋 */
  buildingOfPoint: (pointId: string) => string
}

function labelOf<T extends readonly { key: string; name: string }[]>(list: T, key: string): string {
  return list.find((row) => row.key === key)?.name ?? key
}

export function eventRows(events: AlarmEvent[], names: NameResolvers): { header: string[]; rows: string[][] } {
  return {
    header: ['事件编号', '楼栋', '测点', '规则', '当前等级', '最高等级', '状态', '产生时间', '最近触发时间', '触发值', '活跃证据数', '确认时间', '关闭时间', '关闭依据'],
    rows: events.map((row) => [
      row.eventNo,
      names.building(names.buildingOfPoint(row.pointId)),
      names.point(row.pointId),
      row.ruleCode,
      EVENT_LEVEL_LABEL[row.level],
      EVENT_LEVEL_LABEL[row.peakLevel],
      EVENT_STATUS_LABEL[row.status],
      formatDateTime(row.openedAt),
      formatDateTime(row.lastTriggerAt),
      `${row.lastTriggerValue}${row.unit}`,
      String(row.evidences.length),
      row.acknowledgedAt === null ? '' : formatDateTime(row.acknowledgedAt),
      row.closedAt === null ? '' : formatDateTime(row.closedAt),
      row.closeBasis,
    ]),
  }
}

export function issueRows(issues: InspectionIssue[], names: NameResolvers): { header: string[]; rows: string[][] } {
  return {
    header: ['问题编号', '楼栋', '测点', '来源', '异常类型', '状态', '描述', '审核出口', '审核分类', '审核时间', '关联工单', '登记复查轮次', '最近目标日期'],
    rows: issues.map((row) => {
      const rounds = row.rechecks ?? []
      const last = rounds.length === 0 ? undefined : rounds[rounds.length - 1]
      return [
        row.issueNo,
        names.building(row.buildingId),
        names.point(row.pointId),
        labelOf(ISSUE_SOURCES, row.source),
        row.anomalyType,
        labelOf(ISSUE_STATUSES, row.status),
        row.description,
        row.reviewAction ?? '',
        row.reviewCategory,
        row.reviewedAt === null ? '' : formatDateTime(row.reviewedAt),
        row.workOrderIds.join(' / '),
        String(rounds.length),
        last === undefined ? '' : last.dueDate,
      ]
    }),
  }
}

export function orderRows(orders: WorkOrder[], names: NameResolvers): { header: string[]; rows: string[][] } {
  return {
    header: ['工单编号', '来源', '测点', '状态', '维修人', '派工时间', '提交完工时间', '维修措施', '材料', '完工照片数', '验收次数', '最近验收结论'],
    rows: orders.map((row) => {
      const last = row.reviews.length === 0 ? undefined : row.reviews[row.reviews.length - 1]
      return [
        row.orderNo,
        row.origin,
        names.point(row.pointId),
        row.status,
        row.assignee,
        row.assignedAt === null ? '' : formatDateTime(row.assignedAt),
        row.submittedAt === null ? '' : formatDateTime(row.submittedAt),
        row.measures,
        row.materials,
        String(row.photos.length),
        String(row.reviews.length),
        last === undefined ? '' : `${last.action === 'verify' ? '验收通过' : '验收退回'}（${last.result === 'pass' ? '合格' : '不合格'}）`,
      ]
    }),
  }
}

export function maintenanceRows(tasks: MaintenanceTask[]): { header: string[]; rows: string[][] } {
  return {
    header: ['任务编号', '计划', '设备', '计划执行时间', '当日截止', '状态', '执行时间', '执行人', '维护措施', '材料', '现场照片数', '下次保养日期', '异常项数'],
    rows: tasks.map((row) => {
      const execution = row.execution
      const abnormal = execution === null ? 0 : execution.checklist.filter((item) => item.result === 'abnormal').length
      return [
        row.taskNo,
        row.snapshot.planName,
        row.snapshot.deviceName,
        formatDateTime(row.plannedAt),
        formatDateTime(row.dueAt),
        row.status === 'done' ? '已完成' : '待保养',
        execution === null ? '' : formatDateTime(execution.at),
        execution === null ? '' : execution.by,
        execution === null ? '' : execution.measures,
        execution === null ? '' : execution.materials,
        execution === null ? '0' : String(execution.photos.length),
        execution === null ? '' : execution.nextDueDate,
        execution === null ? '' : String(abnormal),
      ]
    }),
  }
}

/** 生成 CSV 文件：加 BOM，Windows Excel 打开 UTF-8 中文才不会乱码。 */
export function csvBlob(header: string[], rows: string[][]): Blob {
  return new Blob([`\uFEFF${toCsv(header, rows)}`], { type: 'text/csv;charset=utf-8' })
}

/** 触发浏览器下载。空表也允许导出（只有表头），但要由页面先提示"暂无数据"。 */
export function downloadCsv(fileName: string, header: string[], rows: string[][]): void {
  const blob = csvBlob(header, rows)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  /*
   * 延到下一个宏任务再释放：`link.click()` 之后同步 revoke 会把「还在读取 blob」的下载掐断
   * （在只提供 IAB 后端的会话里必现 `download cancelled`）。推迟一拍既让下载拿到数据，
   * 也不会长期占着内存。
   */
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
