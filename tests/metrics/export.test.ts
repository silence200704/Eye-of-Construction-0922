/**
 * 明细 CSV 导出的列与行口径测试（V1-E）。
 *
 * 重点：导出的行数必须等于页面明细条数（同一筛选条件），列里带业务编号能回系统核对，
 * 空字段导出成空串而不是 "undefined" 或 "NaN"。
 */
import { describe, expect, it } from 'vitest'
import { csvBlob, eventRows, issueRows, maintenanceRows, orderRows, type NameResolvers } from '@/core/metrics/export'
import { toCsv } from '@/core/csv'
import { makeEvent } from '../fixtures'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'
import type { MaintenanceTask } from '@/types/maintenance'

const AT = '2026-09-20T01:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const NAMES: NameResolvers = {
  point: (id) => (id === null ? '' : `测点-${id}`),
  building: (id) => `楼栋-${id}`,
  buildingOfPoint: (id) => (id === 'pnt_1' ? 'bld_1' : ''),
}

const ISSUE: InspectionIssue = {
  ...AUDIT,
  id: 'iss_1',
  issueNo: 'ISS-20260920-001',
  source: 'maintenance',
  submissionKey: 'sk_1',
  pointId: 'pnt_1',
  buildingId: 'bld_1',
  floorId: 'flr_1',
  zoneId: '二层走廊',
  eventId: null,
  taskId: null,
  anomalyType: '保养发现异常',
  description: '螺栓锈蚀',
  photos: [],
  status: 'pending_review',
  reviewAction: null,
  reviewCategory: '',
  reviewedAt: null,
  reviewedBy: '',
  reviewNote: '',
  duplicateOf: null,
  linkedEventId: null,
  linkedFrom: [],
  workOrderIds: [],
  rechecks: [],
  timeline: [],
}

const ORDER: WorkOrder = {
  ...AUDIT,
  id: 'wo_1',
  orderNo: 'WO-20260920-001',
  origin: 'issue',
  issueId: 'iss_1',
  eventId: null,
  pointId: 'pnt_1',
  title: '裂缝处置',
  status: 'assigned',
  assignee: '维修师傅',
  assignedBy: '张工',
  assignedAt: AT,
  dueAt: null,
  measures: '',
  materials: '',
  photos: [],
  submittedAt: null,
  reviews: [],
  timeline: [],
}

const TASK: MaintenanceTask = {
  ...AUDIT,
  id: 'plan_m1@2026-09-20T01:00:00.000Z',
  taskNo: 'MT-20260920-001',
  planId: 'plan_m1',
  deviceId: 'dev_1',
  plannedAt: AT,
  dueAt: '2026-09-20T15:59:59.000Z',
  status: 'pending',
  snapshot: {
    planCode: 'MP-20260901-001',
    planName: '裂缝传感器月度保养',
    deviceCode: 'B03-F2-CRACK01-DEV1',
    deviceName: '裂缝位移探头',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    owner: '王师傅',
    cycle: { unit: 'month', interval: 1, atTime: '09:00' },
    checklist: [],
  },
  execution: null,
  timeline: [],
}

describe('明细导出', () => {
  it('事件明细：行数等于输入行数，且带楼栋、测点与关闭依据', () => {
    const table = eventRows([makeEvent({ closeBasis: '工单验收通过' })], NAMES)
    expect(table.rows).toHaveLength(1)
    expect(table.rows[0][0]).toBe('E20260920-001')
    expect(table.rows[0][1]).toBe('楼栋-bld_1')
    expect(table.rows[0][2]).toBe('测点-pnt_1')
    expect(table.rows[0][table.header.indexOf('关闭依据')]).toBe('工单验收通过')
    // 未确认、未关闭导出成空串，不能写成 undefined
    expect(table.rows[0][table.header.indexOf('确认时间')]).toBe('')
    expect(toCsv(table.header, table.rows)).not.toContain('undefined')
  })

  it('问题明细：来源用中文名，复查轮次与最近目标日期按登记顺序取最后一条', () => {
    const table = issueRows(
      [
        {
          ...ISSUE,
          rechecks: [
            { subject: '复测', owner: '李老师', dueDate: '2026-09-18', at: AT, by: '张工', outcome: 'observing', outcomeAt: AT, outcomeBy: '张工', outcomeNote: '' },
            { subject: '再复测', owner: '李老师', dueDate: '2026-09-25', at: AT, by: '张工', outcome: null, outcomeAt: null, outcomeBy: '', outcomeNote: '' },
          ],
        },
      ],
      NAMES,
    )
    expect(table.rows[0][table.header.indexOf('来源')]).toBe('保养发现')
    expect(table.rows[0][table.header.indexOf('登记复查轮次')]).toBe('2')
    expect(table.rows[0][table.header.indexOf('最近目标日期')]).toBe('2026-09-25')
  })

  it('工单明细：未验收时最近验收结论为空串而不是"undefined"', () => {
    const table = orderRows([ORDER], NAMES)
    expect(table.rows[0][table.header.indexOf('最近验收结论')]).toBe('')
    expect(table.rows[0][table.header.indexOf('提交完工时间')]).toBe('')
    expect(table.rows[0][table.header.indexOf('验收次数')]).toBe('0')
  })

  it('保养明细：未完成任务的执行字段全为空串，已完成任务带措施与照片数', () => {
    const pending = maintenanceRows([TASK])
    expect(pending.rows[0][pending.header.indexOf('状态')]).toBe('待保养')
    expect(pending.rows[0][pending.header.indexOf('维护措施')]).toBe('')
    const done = maintenanceRows([
      {
        ...TASK,
        status: 'done',
        execution: {
          at: AT,
          by: '王师傅',
          byRole: '物业值班人员',
          checklist: [{ key: 'surface', label: '外壳', result: 'abnormal', note: '' }],
          measures: '除锈并紧固',
          materials: '防锈漆',
          photos: ['att_1'],
          nextDueDate: '2026-10-20',
          note: '',
        },
      },
    ])
    expect(done.rows[0][done.header.indexOf('状态')]).toBe('已完成')
    expect(done.rows[0][done.header.indexOf('维护措施')]).toBe('除锈并紧固')
    expect(done.rows[0][done.header.indexOf('现场照片数')]).toBe('1')
    expect(done.rows[0][done.header.indexOf('下次保养日期')]).toBe('2026-10-20')
    expect(done.rows[0][done.header.indexOf('异常项数')]).toBe('1')
  })
})


describe('CSV 字节编码', () => {
  it('以 UTF-8 BOM 开头，中文标题与业务编号完整保留', async () => {
    const blob = csvBlob(['问题编号', '楼栋'], [['ISS-20260922-001', '3号教学楼']])
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(blob.type).toBe('text/csv;charset=utf-8')
    expect(await blob.text()).toContain('ISS-20260922-001')
    expect(await blob.text()).toContain('3号教学楼')
  })
})
