/**
 * 到点与检查完成的判定测试（第三步口径）。
 *
 * 六条不可退让的规则：
 * ① 编号一致或人工兜底写清原因 → 只进入"已到点，待检查"；
 * ② 编号不一致 → 只追加失败尝试，不改动既有状态；
 * ③ 已完成的点再扫错卡 → 保留失败留痕，绝不退回待检查；
 * ④ 必答清单全部作答后，才允许提交"检查完成"；
 * ⑤ 清单出现异常 → 必须建问题，或写明"无需建问题"的依据（≥10 字）；
 * ⑥ 未到点不能提交检查完成。
 */
import { describe, expect, it } from 'vitest'
import { applyCheckIn, checkIn, completeCheck, labelConflict, labelFormatHint, rebindLabel } from '@/core/inspection/checkIn'
import type { ChecklistAnswer, TaskCheckResult } from '@/types/inspection'
import { makePoint } from '../fixtures'

const AT = '2026-09-20T09:10:00.000Z'
const LATER = '2026-09-20T10:30:00.000Z'
const point = makePoint({ id: 'pnt_1', code: 'B03-F2-CRACK01' })
const withLabel = { ...point, nfc: { code: 'NFC-B03-F2-CRACK01', version: 2, boundAt: AT, boundBy: '测试', remark: '' } }

function pending(): TaskCheckResult {
  return {
    pointId: 'pnt_1',
    status: 'pending',
    checkedAt: null,
    method: null,
    labelRead: '',
    labelExpected: '',
    labelVersion: null,
    fallbackReason: '',
    attempts: [],
    checklist: [],
    abnormalHandling: { linkedIssueId: null, reason: '' },
    issueValid: false,
    issueIds: [],
  }
}

const answers = (abnormal: boolean): ChecklistAnswer[] => [
  { key: 'surface', label: '外观是否完好', result: 'ok', note: '' },
  { key: 'fixing', label: '固定是否牢靠', result: abnormal ? 'abnormal' : 'ok', note: abnormal ? '支架晃动' : '' },
]

function arrivedResult(): TaskCheckResult {
  return applyCheckIn(pending(), { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', point: withLabel, at: AT })
}

describe('到点判定（只代表到点，不代表查完）', () => {
  it('编号一致即可到点，并记录标签版本', () => {
    const out = checkIn({ labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', point: withLabel, at: AT })
    expect(out.passed).toBe(true)
    expect(out.labelVersion).toBe(2)
  })

  it('到点后状态是"已到点，待检查"，不是"检查完成"', () => {
    const next = arrivedResult()
    expect(next.status).toBe('arrived')
    expect(next.checkedAt).toBe(AT)
    expect(next.attempts).toHaveLength(1)
    expect(next.attempts[0].passed).toBe(true)
  })

  it('人工兜底必须写原因，写了才算到点', () => {
    const denied = checkIn({ labelRead: 'NFC-B03-F2-CRACK01', method: 'manual', fallbackReason: '  ', point: withLabel, at: AT })
    expect(denied.passed).toBe(false)
    const ok = applyCheckIn(pending(), {
      labelRead: 'NFC-B03-F2-CRACK01',
      method: 'manual',
      fallbackReason: '标签表面磨损读不出，按现场编号人工输入',
      point: withLabel,
      at: AT,
    })
    expect(ok.status).toBe('arrived')
    expect(ok.method).toBe('manual')
    expect(ok.fallbackReason).toContain('人工输入')
  })

  it('编号不一致只留痕：状态仍是待到点，checkedAt 不被写', () => {
    const next = applyCheckIn(pending(), { labelRead: 'NFC-OTHER', method: 'nfc', fallbackReason: '', point: withLabel, at: AT })
    expect(next.status).toBe('pending')
    expect(next.checkedAt).toBeNull()
    expect(next.attempts).toHaveLength(1)
    expect(next.attempts[0].passed).toBe(false)
    expect(next.attempts[0].message).toContain('错点不计入到点')
  })

  it('未登记标签的点位不能到点', () => {
    const out = checkIn({ labelRead: 'NFC-ANY', method: 'nfc', fallbackReason: '', point: { ...point, nfc: null }, at: AT })
    expect(out.passed).toBe(false)
    expect(out.message).toContain('未登记 NFC 标签')
  })
})

describe('失败留痕不覆盖既有状态', () => {
  it('已到点后再扫错卡：状态保持已到点，历史尝试都留着', () => {
    const after = applyCheckIn(arrivedResult(), { labelRead: 'NFC-B01-F1-CRACK01', method: 'nfc', fallbackReason: '', point: withLabel, at: LATER })
    expect(after.status).toBe('arrived')
    expect(after.checkedAt).toBe(AT)
    expect(after.attempts).toHaveLength(2)
    expect(after.attempts.map((row) => row.passed)).toEqual([true, false])
    expect(after.attempts[1].labelRead).toBe('NFC-B01-F1-CRACK01')
  })

  it('检查完成后扫错卡：绝不退回待检查或已到点', () => {
    const done = completeCheck({
      result: arrivedResult(),
      answers: answers(false),
      requiredKeys: ['surface', 'fixing'],
      abnormalHandling: { linkedIssueId: null, reason: '' },
    issueValid: false,
      at: LATER,
    }).next as TaskCheckResult
    const after = applyCheckIn(done, { labelRead: 'NFC-OTHER', method: 'nfc', fallbackReason: '', point: withLabel, at: LATER })
    expect(after.status).toBe('completed')
    expect(after.checklist).toHaveLength(2)
    expect(after.attempts).toHaveLength(2)
    expect(after.attempts[1].passed).toBe(false)
  })

  it('检查完成后重新正确打卡也不改变完成状态', () => {
    const done = completeCheck({
      result: arrivedResult(),
      answers: answers(false),
      requiredKeys: ['surface', 'fixing'],
      abnormalHandling: { linkedIssueId: null, reason: '' },
    issueValid: false,
      at: LATER,
    }).next as TaskCheckResult
    const again = applyCheckIn(done, { labelRead: 'NFC-B03-F2-CRACK01', method: 'nfc', fallbackReason: '', point: withLabel, at: LATER })
    expect(again.status).toBe('completed')
    expect(again.checkedAt).toBe(AT)
  })
})

describe('提交检查完成的前置条件', () => {
  it('未到点不能提交检查完成', () => {
    const out = completeCheck({ result: pending(), answers: answers(false), requiredKeys: ['surface'], abnormalHandling: { created: false, reason: '' }, at: AT })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('尚未到点')
  })

  it('必答项没答完不能提交', () => {
    const partial: ChecklistAnswer[] = [
      { key: 'surface', label: '外观是否完好', result: 'ok', note: '' },
      { key: 'fixing', label: '固定是否牢靠', result: null, note: '' },
    ]
    const out = completeCheck({ result: arrivedResult(), answers: partial, requiredKeys: ['surface', 'fixing'], abnormalHandling: { created: false, reason: '' }, at: AT })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('必答检查项')
  })

  it('必答项答完即可提交，清单与异常处置一并写回', () => {
    const out = completeCheck({ result: arrivedResult(), answers: answers(false), requiredKeys: ['surface', 'fixing'], abnormalHandling: { created: false, reason: '' }, at: AT })
    expect(out.ok).toBe(true)
    expect(out.next?.status).toBe('completed')
    expect(out.next?.checklist.map((row) => row.result)).toEqual(['ok', 'ok'])
  })

  it('出现异常必须建问题或写明依据（依据不少于 10 字）', () => {
    const denied = completeCheck({
      result: arrivedResult(),
      answers: answers(true),
      requiredKeys: ['surface', 'fixing'],
      abnormalHandling: { linkedIssueId: null, reason: '没事' },
      issueValid: false,
      at: AT,
    })
    expect(denied.ok).toBe(false)
    expect(denied.error).toContain('无需建问题')

    const okByReason = completeCheck({
      result: arrivedResult(),
      answers: answers(true),
      requiredKeys: ['surface', 'fixing'],
      abnormalHandling: { linkedIssueId: null, reason: '支架轻微晃动但读数稳定，现场观察后判断无需建问题' },
      issueValid: false,
      at: AT,
    })
    expect(okByReason.ok).toBe(true)

    const okByIssue = completeCheck({
      result: arrivedResult(),
      answers: answers(true),
      requiredKeys: ['surface', 'fixing'],
      abnormalHandling: { linkedIssueId: 'iss_1', reason: '' },
      issueValid: true,
      at: AT,
    })
    expect(okByIssue.ok).toBe(true)
  })

  it('已完成的点位不能重复提交，需走修订', () => {
    const done = completeCheck({
      result: arrivedResult(),
      answers: answers(false),
      requiredKeys: ['surface', 'fixing'],
      abnormalHandling: { linkedIssueId: null, reason: '' },
    issueValid: false,
      at: AT,
    }).next as TaskCheckResult
    const again = completeCheck({ result: done, answers: answers(false), requiredKeys: ['surface'], abnormalHandling: { created: false, reason: '' }, at: LATER })
    expect(again.ok).toBe(false)
    expect(again.error).toContain('检查已完成')
  })
})

describe('标签编号全校唯一', () => {
  const others = [
    { ...makePoint({ id: 'pnt_2', code: 'B03-F2-TILT01' }), nfc: { code: 'NFC-B03-F2-CRACK01', version: 1, boundAt: AT, boundBy: '测试', remark: '' } },
  ]

  it('编号已被别的测点占用时返回冲突点位', () => {
    expect(labelConflict(others, 'NFC-B03-F2-CRACK01', 'pnt_1')?.pointCode).toBe('B03-F2-TILT01')
  })

  it('换绑同一个点位自己的编号不算冲突', () => {
    expect(labelConflict(others, 'NFC-B03-F2-CRACK01', 'pnt_2')).toBeNull()
  })

  it('已归档的点位不占用编号', () => {
    const archived = [{ ...others[0], status: 'archived' as const }]
    expect(labelConflict(archived, 'NFC-B03-F2-CRACK01', 'pnt_1')).toBeNull()
  })

  it('留空编号不做冲突判定', () => {
    expect(labelConflict(others, '   ', 'pnt_1')).toBeNull()
  })

  it('编号格式提示：非 NFC- 前缀给建议，留空说明后果', () => {
    expect(labelFormatHint('NFC-B03-F2-CRACK01', 'B03-F2-CRACK01')).toBe('')
    expect(labelFormatHint('12345678', 'B03-F2-CRACK01')).toContain('建议使用 NFC- 前缀')
    expect(labelFormatHint('', 'B03-F2-CRACK01')).toContain('人工兜底')
  })

  it('换绑标签版本递增，历史记录里的旧编号与版本不变', () => {
    const rebind = rebindLabel(withLabel, 'NFC-B03-F2-CRACK01-NEW', AT, '设备管理员', '标签损坏更换')
    expect(rebind.nfc?.version).toBe(3)
    expect(withLabel.nfc?.version).toBe(2)
  })
})
