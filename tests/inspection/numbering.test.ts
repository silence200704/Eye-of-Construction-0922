/**
 * V0.3 编号规则测试：ISS/WO/TK/PLAN 按本地日期 + 当日序号递增，作废不复用。
 */
import { describe, expect, it } from 'vitest'
import { nfcLabelOf, nextDatedNo, nextIssueNo, nextPlanCode, nextTaskNo, nextWorkOrderNo } from '@/core/id'

describe('业务编号按日期递增', () => {
  it('当天没有编号时从 001 开始', () => {
    expect(nextIssueNo('20260920', [])).toBe('ISS-20260920-001')
    expect(nextWorkOrderNo('20260920', [])).toBe('WO-20260920-001')
    expect(nextTaskNo('20260920', [])).toBe('TK-20260920-001')
    expect(nextPlanCode('20260920', [])).toBe('PLAN-20260920-001')
  })

  it('取当天已有编号的最大值加一', () => {
    const exist = ['ISS-20260920-001', 'ISS-20260920-003', 'ISS-20260919-009']
    expect(nextIssueNo('20260920', exist)).toBe('ISS-20260920-004')
  })

  it('作废过的编号不会被复用（历史编号仍占位）', () => {
    // 002 曾经存在过就被计入最大值，即使它现在被作废删除，序号也不会回退
    expect(nextWorkOrderNo('20260920', ['WO-20260920-002'])).toBe('WO-20260920-003')
  })

  it('别的日期与别的前缀互不干扰', () => {
    const rows = ['ISS-20260919-005', 'TK-20260920-004', 'WO-20260920-002']
    expect(nextIssueNo('20260920', rows)).toBe('ISS-20260920-001')
    expect(nextWorkOrderNo('20260920', rows)).toBe('WO-20260920-003')
    expect(nextDatedNo('ISS', '20260921', rows)).toBe('ISS-20260921-001')
  })

  it('标签编号与测点编号绑定，便于现场核对', () => {
    expect(nfcLabelOf('B03-F2-CRACK01')).toBe('NFC-B03-F2-CRACK01')
  })
})
