/**
 * 单事件处置报告的口径测试（V1-E）。
 *
 * 重点：未接入真实渠道的提醒不得写成"已送达"；未确认/未关闭的环节必须如实写出来，
 * 空白会被读成"没问题"；四个环节都要能回答答辩时的那四个问题。
 */
import { describe, expect, it } from 'vitest'
import { buildEventReport } from '@/core/metrics/eventReport'
import { makeDevice, makeEvent, makePoint } from '../fixtures'
import type { InspectionIssue, WorkOrder } from '@/types/inspection'

const AT = '2026-09-20T01:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }

function order(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...AUDIT,
    id: 'wo_1',
    orderNo: 'WO-20260920-001',
    origin: 'event',
    issueId: null,
    eventId: 'evt_1',
    pointId: 'pnt_1',
    title: '裂缝处置',
    status: 'verified',
    assignee: '维修师傅',
    assignedBy: '张工',
    assignedAt: AT,
    dueAt: null,
    measures: '注浆封闭并复测',
    materials: '环氧树脂',
    photos: ['att_1'],
    submittedAt: AT,
    reviews: [{ at: AT, by: '张工', byRole: '学校安全管理人员', action: 'verify', result: 'pass', note: '前后对比合格' }],
    timeline: [],
    ...overrides,
  }
}

function issue(overrides: Partial<InspectionIssue> = {}): InspectionIssue {
  return {
    ...AUDIT,
    id: 'iss_1',
    issueNo: 'ISS-20260920-001',
    source: 'sensor',
    submissionKey: 'sk_1',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    eventId: 'evt_1',
    taskId: null,
    anomalyType: '裂缝扩展',
    description: '西墙裂缝扩展 0.2mm',
    photos: [],
    status: 'closed',
    reviewAction: 'to_repair',
    reviewCategory: 'equipment',
    reviewedAt: AT,
    reviewedBy: '张工',
    reviewNote: '转维修',
    duplicateOf: null,
    linkedEventId: null,
    linkedFrom: [],
    workOrderIds: ['wo_1'],
    rechecks: [],
    timeline: [],
    ...overrides,
  }
}

const POINT = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01', name: '西墙裂缝测点' })
const DEVICE = makeDevice({ id: 'dev_1', pointId: 'pnt_1' })

describe('单事件处置报告', () => {
  it('四个环节齐全，且能回答为何预警、谁处置、如何验收、为何关闭', () => {
    const report = buildEventReport({
      event: makeEvent({ id: 'evt_1', acknowledgedAt: AT, acknowledgedBy: '张工', closedAt: AT, closedBy: '张工', closeBasis: '工单 WO-20260920-001 验收通过，连续 3 条恢复复测' }),
      point: POINT,
      device: DEVICE,
      notifications: [],
      issues: [issue()],
      orders: [order()],
    })
    expect(report.sections.map((row) => row.question)).toEqual(['为何预警', '谁收到、谁确认', '谁处置、如何验收', '为何关闭'])
    expect(report.closed).toBe(true)
    const text = JSON.stringify(report)
    expect(text).toContain('WO-20260920-001')
    expect(text).toContain('验收通过')
    expect(text).toContain('连续 3 条恢复复测')
  })

  it('站内提醒只写生成/展示/确认，不写"已送达"', () => {
    const report = buildEventReport({
      event: makeEvent({ id: 'evt_1' }),
      point: POINT,
      device: DEVICE,
      notifications: [
        {
          id: 'ntf_1',
          eventId: 'evt_1',
          eventNo: 'E20260920-001',
          level: 'orange',
          target: '学校安全管理人员',
          channel: '站内提醒',
          createdAt: AT,
          presentedAt: AT,
          acknowledgedAt: null,
          acknowledgedBy: '',
          dueMinutes: 30,
          fallback: '物业值班人员',
          escalatedAt: AT,
          escalatedTo: '物业值班人员',
          escalationSource: 'demo',
        },
      ],
      issues: [],
      orders: [],
    })
    const text = JSON.stringify(report)
    expect(text).toContain('已生成')
    expect(text).toContain('未确认')
    expect(text).toContain('演示模式模拟')
    expect(text).not.toContain('已送达')
    expect(text).not.toContain('已推送')
  })

  it('未关闭、未确认、未处置的环节如实写出，不留空', () => {
    const report = buildEventReport({
      event: makeEvent({ id: 'evt_1' }),
      point: POINT,
      device: DEVICE,
      notifications: [],
      issues: [],
      orders: [],
    })
    expect(report.closed).toBe(false)
    const text = JSON.stringify(report)
    expect(text).toContain('未确认')
    expect(text).toContain('事件尚未关闭')
    expect(text).toContain('未转问题、也未建工单')
    expect(text).toContain('（未填写）')
  })
})
