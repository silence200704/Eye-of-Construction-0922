/**
 * 审核的结果预览与「无需处理」结构化依据（V1-B 交互收口）。
 *
 * 预览与实际判定必须同源：目标状态取 nextStatusOf()，页面不再自己解释一套；
 * 关闭理由必须能从固定选项里选出来（可统计），「已当场处理」还要有照片或写明拍不了照的原因。
 */
import { describe, expect, it } from 'vitest'
import { nextStatusOf, review } from '@/core/inspection/issueMerge'
import { reviewPreview } from '@/core/inspection/reviewPreview'
import { ISSUE_STATUSES, REVIEW_ACTIONS } from '@/types/inspection'
import type { InspectionIssue } from '@/types/inspection'

const AT = '2026-09-20T09:00:00.000Z'
const AUDIT = { createdAt: AT, createdBy: '测试', updatedAt: AT, updatedBy: '测试' }
const ACTOR = { by: '演示操作员', byRole: 'safety' }

function issueStatusName(key: InspectionIssue['status']): string {
  return ISSUE_STATUSES.find((row) => row.key === key)?.name ?? key
}

function issue(override: Partial<InspectionIssue> = {}): InspectionIssue {
  return {
    ...AUDIT,
    id: 'iss_1',
    issueNo: 'ISS-20260920-001',
    source: 'report',
    submissionKey: 'report:pnt_1:探头松动:1',
    pointId: 'pnt_1',
    buildingId: 'bld_1',
    floorId: 'flr_1',
    zoneId: '二层走廊',
    eventId: null,
    taskId: null,
    anomalyType: '探头松动',
    description: '现场发现探头支架松动',
    photos: [],
    status: 'pending_review',
    reviewAction: null,
    reviewCategory: '',
    linkedEventId: null,
    reviewedAt: null,
    reviewedBy: '',
    reviewNote: '',
    duplicateOf: null,
    workOrderIds: [],
    timeline: [],
    ...override,
  }
}

/**
 * 「无需处理并关闭」的结构化依据。
 *
 * 只写一句说明是不够的：关闭理由要能从固定选项里选出来（可统计），
 * 而「已当场处理」是唯一一个"处理动作已经发生过"的理由 —— 要么有现场照片，要么写明拍不了照的原因。
 */
describe('无需处理的结构化依据', () => {
  const close = { action: 'close_no_fault' as const, at: AT, ...ACTOR }

  it('原因类型是必选的，且必须是该出口允许的选项', () => {
    const missing = review({ issue: issue(), category: '', note: '现场复查确认无新增裂缝，读数稳定', ...close })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('二级分类')

    const wrong = review({ issue: issue(), category: 'handled_x', note: '现场复查确认无新增裂缝，读数稳定', ...close })
    expect(wrong.ok).toBe(false)
  })

  it('「读数稳定」是可选的关闭理由之一', () => {
    const out = review({ issue: issue(), category: 'reading_stable', note: '连续复查读数都在噪声范围内，未发现结构变化', ...close })
    expect(out.ok).toBe(true)
    expect(out.nextStatus).toBe('closed')
  })

  it('说明太短不算依据（不能拿几个字糊过去）', () => {
    const short = review({ issue: issue(), category: 'reading_stable', note: '读数稳定', ...close })
    expect(short.ok).toBe(false)
    expect(short.error).toContain('不少于 10 个字')
  })

  it('「已当场处理」没有照片也没有原因时被拒', () => {
    const out = review({ issue: issue(), category: 'handled', note: '现场已用水泥砂浆临时封堵处理完毕', photoCount: 0, noPhotoReason: '', ...close })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('现场照片')
  })

  it('「已当场处理」有照片即可通过', () => {
    const out = review({ issue: issue(), category: 'handled', note: '现场已用水泥砂浆临时封堵处理完毕', photoCount: 2, noPhotoReason: '', ...close })
    expect(out.ok).toBe(true)
  })

  it('「已当场处理」写清无法拍照的原因也可以通过，但原因太短不行', () => {
    const short = review({ issue: issue(), category: 'handled', note: '现场已用水泥砂浆临时封堵处理完毕', photoCount: 0, noPhotoReason: '忘了拍', ...close })
    expect(short.ok).toBe(false)

    const ok = review({
      issue: issue(),
      category: 'handled',
      note: '现场已用水泥砂浆临时封堵处理完毕',
      photoCount: 0,
      noPhotoReason: '处理位置在吊顶内部，作业面无法拍照，已由现场两人复核确认',
      ...close,
    })
    expect(ok.ok).toBe(true)
  })

  it('照片是随本次审核一起写入的：判定看"本次操作后的状态"', () => {
    // 库里还没有照片，但这次提交带了 1 张 —— 必须按有照片处理
    const out = review({ issue: issue({ photos: [] }), category: 'handled', note: '现场已用水泥砂浆临时封堵处理完毕', photoCount: 1, noPhotoReason: '', ...close })
    expect(out.ok).toBe(true)
  })
})

/** 审核结果预览：文案可以不同，但目标状态必须与判定同源。 */
describe('审核结果预览', () => {
  it('每个出口的目标状态都与 nextStatusOf 一致（预览与实际不会各说一套）', () => {
    for (const item of REVIEW_ACTIONS) {
      const preview = reviewPreview({ action: item.key, categoryLabel: '' })
      expect(preview.statusLabel).toBe(issueStatusName(nextStatusOf(item.key)))
    }
  })

  it('转维修要说明会自动建工单，关闭要说明不代表事件自动关闭', () => {
    const repair = reviewPreview({ action: 'to_repair', categoryLabel: '设备故障' })
    expect(repair.createsWorkOrder).toBe(true)
    expect(repair.owner).toContain('维修')
    expect(repair.nextAction).toContain('设备故障')

    const close = reviewPreview({ action: 'close_no_fault', categoryLabel: '读数稳定' })
    expect(close.createsWorkOrder).toBe(false)
    expect(close.affects).toContain('不代表')
  })

  it('不可逆的出口要标出来，普通流转不标', () => {
    expect(reviewPreview({ action: 'link_object', categoryLabel: '' }).irreversible).toBe(true)
    expect(reviewPreview({ action: 'close_no_fault', categoryLabel: '' }).irreversible).toBe(true)
    expect(reviewPreview({ action: 'recheck', categoryLabel: '' }).irreversible).toBe(false)
    expect(reviewPreview({ action: 'to_repair', categoryLabel: '' }).irreversible).toBe(false)
  })
})
