/**
 * 证据修订测试：修订仍越限时替代旧证据，修订为不越限时撤销证据，
 * 事件等级按剩余活跃证据重新汇总（回落是正确行为）。
 */
import { describe, expect, it } from 'vitest'
import { assessRecord, previewRecord, snapshotOf } from '@/core/rules'
import { planRevision } from '@/core/event/plan'
import type { AlarmEvent, EventEvidence } from '@/types/events'
import { makeEvent, makePoint, makeRecord, makeRule } from '../fixtures'

const ACTOR = { name: '演示操作员', role: '学校安全管理人员' }
const NOW = '2026-09-20T09:00:00.000Z'

/* ---------------- 修订记录后的事件证据 ---------------- */

describe('修订记录后的事件证据', () => {
  function evidenceOf(override: Partial<EventEvidence> = {}): EventEvidence {
    return {
      recordId: 'rec_1',
      recordNo: 'R20260920-001',
      sampleTime: NOW,
      level: 'yellow',
      triggerValue: 0.12,
      baselineValue: 0.5,
      ruleCode: 'RULE-CRACK-001',
      ruleVersion: 'V1.0',
      thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
      basis: '相对基准变化量绝对值',
      reason: '判定值 0.12 mm 达到黄色关注门槛',
      addedAt: NOW,
      addedBy: '测试',
      addedByRole: '学校安全管理人员',
      ...override,
    }
  }

  function revise(width: number, open: AlarmEvent, recordId = 'rec_1') {
    const rule = makeRule()
    const point = makePoint()
    const current = previewRecord({
      pointId: point.id,
      metric: 'crack_width',
      values: { width },
      baselineValues: { width: 0.5 },
      unit: 'mm',
      sampleTime: NOW,
      sampleWindow: '',
    })
    const assessment = assessRecord({
      rule,
      point,
      values: { width },
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history: [current],
      at: NOW,
    })
    return planRevision({
      open,
      record: makeRecord({ id: recordId, values: { width }, sampleTime: NOW }),
      assessment,
      snapshot: snapshotOf(rule),
      actor: ACTOR,
      at: NOW,
      reason: '原记录填写有误，按现场复测更正',
    })
  }

  it('修订仍越限：旧证据被替代，同一 recordId 只保留一条活跃证据', () => {
    const open = makeEvent({ level: 'yellow', peakLevel: 'yellow', evidences: [evidenceOf()] })
    const result = revise(0.73, open)
    expect(result.action).toBe('replaced')
    expect(result.superseded?.recordId).toBe('rec_1')
    expect(result.evidence?.recordId).toBe('rec_1')
    // 替换后的等级按活跃证据重新汇总
    expect(result.nextLevel).toBe('orange')
    expect(result.notifyLevel).toBe('orange')
  })

  it('修订为不再越限：证据被撤销，等级按剩余活跃证据回落', () => {
    const open = makeEvent({ level: 'yellow', peakLevel: 'yellow', evidences: [evidenceOf()] })
    const result = revise(0.52, open)
    expect(result.action).toBe('withdrawn')
    expect(result.superseded?.recordId).toBe('rec_1')
    expect(result.evidence).toBeNull()
    // 没有活跃证据时保持原等级，不出现没有证据支撑的等级
    expect(result.nextLevel).toBe('yellow')
  })

  it('撤销支撑红色的证据后，事件等级回落到剩余活跃证据的等级', () => {
    const red: EventEvidence = evidenceOf({ recordId: 'rec_2', level: 'red', triggerValue: 0.32 })
    const open = makeEvent({
      level: 'red',
      peakLevel: 'red',
      evidences: [evidenceOf({ recordId: 'rec_1', level: 'yellow' }), red],
    })
    // 把支撑红色的那条记录修订为不再越限
    const result = revise(0.52, open, 'rec_2')
    expect(result.action).toBe('withdrawn')
    expect(result.superseded?.recordId).toBe('rec_2')
    // 剩 rec_1 一条黄色证据，等级与最高等级都按活跃证据回落
    expect(result.nextLevel).toBe('yellow')
    expect(result.nextPeakLevel).toBe('yellow')
  })

  it('事件里没有该记录的证据时不改动事件', () => {
    const open = makeEvent({ evidences: [evidenceOf({ recordId: 'rec_other' })] })
    expect(revise(0.73, open).action).toBe('none')
  })
})
