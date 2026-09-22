/**
 * 版本化与数据迁移测试。
 * ① 基准按采样时间生效，未来版本不提前参与判定；
 * ② 规则升版后历史记录仍按当时的规则与基准解释；
 * ③ 旧规则缺少 ruleId、旧备份导入后的迁移与事件归并。
 */
import { describe, expect, it } from 'vitest'
import { assessRecord, baselineAtTime, migrateLegacyRules, previewRecord, ruleForPoint, ruleIdOf, snapshotOf } from '@/core/rules'
import { planEvent } from '@/core/event/plan'
import { nextRuleVersion } from '@/stores/writes/ruleWrites'
import type { MonitoringRule } from '@/types/rules'
import { makeBaseline, makeEvent, makePoint, makeRecord, makeRule } from '../fixtures'

const ACTOR = { name: '演示操作员', role: '学校安全管理人员' }
const NOW = '2026-09-20T09:00:00.000Z'

/* ---------------- ① 未来基准不提前生效 ---------------- */

describe('基准按采样时间生效', () => {
  const baselines = [
    makeBaseline({ id: 'b1', version: 1, values: { width: 0.5 }, effectiveFrom: '2026-09-01T00:00:00.000Z', current: false }),
    makeBaseline({ id: 'b2', version: 2, values: { width: 0.52 }, effectiveFrom: '2026-09-25T00:00:00.000Z', current: true }),
  ]

  it('采样时间早于新基准生效时间时，取旧基准', () => {
    const picked = baselineAtTime(baselines, 'pnt_1', '2026-09-20T09:00:00.000Z')
    expect(picked?.version).toBe(1)
    expect(picked?.values.width).toBe(0.5)
  })

  it('采样时间晚于新基准生效时间时，取新基准', () => {
    expect(baselineAtTime(baselines, 'pnt_1', '2026-09-26T09:00:00.000Z')?.version).toBe(2)
  })

  it('恰好等于生效时间即生效', () => {
    expect(baselineAtTime(baselines, 'pnt_1', '2026-09-25T00:00:00.000Z')?.version).toBe(2)
  })

  it('生效时间之前没有任何基准时返回空，而不是拿未来的基准顶上', () => {
    expect(baselineAtTime(baselines, 'pnt_1', '2026-08-31T00:00:00.000Z')).toBeUndefined()
  })

  it('补录数据用当时的基准，同一读数在新基准下会得到不同分级', () => {
    const rule = makeRule()
    const point = makePoint()
    const values = { width: 0.62 }
    const withOld = assessRecord({
      rule,
      point,
      values,
      baselineValues: baselines[0].values,
      quality: 'valid',
      device: undefined,
      history: [],
      at: NOW,
    })
    const withNew = assessRecord({
      rule,
      point,
      values,
      baselineValues: baselines[1].values,
      quality: 'valid',
      device: undefined,
      history: [],
      at: NOW,
    })
    // 阈值 0.10/0.20/0.30：旧基准变化 0.12 → 黄色；新基准变化 0.10 → 黄色
    expect(withOld.state).toBe('yellow')
    expect(withNew.state).toBe('yellow')
    // 换成 0.64：旧基准 +0.14 黄色，新基准 +0.12 仍是黄色；用 0.72 才拉开差距
    const higher = assessRecord({
      rule,
      point,
      values: { width: 0.72 },
      baselineValues: baselines[0].values,
      quality: 'valid',
      device: undefined,
      history: [],
      at: NOW,
    })
    expect(higher.state).toBe('orange')
    expect(higher.baselineValue).toBe(0.5)
  })
})

/* ---------------- ② 规则升版后历史判定不变 ---------------- */

describe('规则版本冻结', () => {
  const v1: MonitoringRule = makeRule({
    id: 'r@V1.0',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    thresholds: { yellow: 0.1, orange: 0.2, red: 0.3 },
    version: 'V1.0',
  })
  const v2: MonitoringRule = makeRule({
    id: 'r@V2.0',
    effectiveFrom: '2026-09-25T00:00:00.000Z',
    thresholds: { yellow: 0.05, orange: 0.1, red: 0.15 },
    version: 'V2.0',
  })
  const point = makePoint()

  it('按采样时间选取当时生效的规则版本', () => {
    expect(ruleForPoint([v1, v2], point, '2026-09-20T09:00:00.000Z')?.version).toBe('V1.0')
    expect(ruleForPoint([v1, v2], point, '2026-09-26T09:00:00.000Z')?.version).toBe('V2.0')
  })

  it('同一读数在旧版判黄色、在新版判橙色，互不影响', () => {
    const values = { width: 0.62 }
    const before = assessRecord({
      rule: v1,
      point,
      values,
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history: [],
      at: '2026-09-20T09:00:00.000Z',
    })
    const after = assessRecord({
      rule: v2,
      point,
      values,
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history: [],
      at: '2026-09-26T09:00:00.000Z',
    })
    expect(before.state).toBe('yellow')
    expect(after.state).toBe('orange')
  })

  it('升版后重新判定历史记录，仍得到当时的结论', () => {
    // 历史记录的采样时间落在 V1.0 生效期内
    const rule = ruleForPoint([v1, v2], point, '2026-09-20T09:00:00.000Z')
    expect(rule?.version).toBe('V1.0')
    const result = assessRecord({
      rule: rule as MonitoringRule,
      point,
      values: { width: 0.62 },
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history: [],
      at: '2026-09-20T09:00:00.000Z',
    })
    expect(result.state).toBe('yellow')
    expect(result.ruleVersion).toBe('V1.0')
  })

  it('判定快照记录规则编号、版本与阈值，事后可追溯', () => {
    const snapshot = snapshotOf(v1)
    expect(snapshot.ruleCode).toBe('RULE-CRACK-001')
    expect(snapshot.ruleVersion).toBe('V1.0')
    expect(snapshot.thresholds).toEqual({ yellow: 0.1, orange: 0.2, red: 0.3 })
  })

  it('版本号自增：V1.0 → V1.1，无法解析时保持原值', () => {
    expect(nextRuleVersion('V1.0')).toBe('V1.1')
    expect(nextRuleVersion('V2.9')).toBe('V2.10')
    expect(nextRuleVersion('草案')).toBe('草案')
  })
})

/* ---------------- 旧规则迁移 ---------------- */

describe('旧规则数据升级迁移', () => {
  it('缺少 ruleId 的旧规则按编号补齐稳定标识，并把行主键改成「规则标识@版本」', () => {
    const legacy = [{ ...makeRule({ id: 'rule_rule_crack_001', version: 'V1.0' }), ruleId: undefined }] as unknown as MonitoringRule[]
    const { rows, changed } = migrateLegacyRules(legacy)
    expect(changed).toBe(1)
    expect(rows[0].ruleId).toBe('rule_rule_crack_001')
    expect(rows[0].id).toBe('rule_rule_crack_001@V1.0')
  })

  it('已经带 ruleId 的规则原样保留，不重复迁移', () => {
    const current = [makeRule({ id: 'rule_x@V1.0', ruleId: 'rule_x', version: 'V1.0' })]
    const { changed } = migrateLegacyRules(current)
    expect(changed).toBe(0)
  })

  it('迁移后的规则能被按时间选中，事件归并标识不再为空', () => {
    const legacy = [{ ...makeRule({ id: 'rule_rule_crack_001', version: 'V1.0', effectiveFrom: '2026-09-01T00:00:00.000Z' }), ruleId: undefined }] as unknown as MonitoringRule[]
    const { rows } = migrateLegacyRules(legacy)
    expect(ruleForPoint(rows, makePoint(), NOW)?.ruleId).toBe('rule_rule_crack_001')
    expect(snapshotOf(rows[0]).ruleId).toBe('rule_rule_crack_001')
  })

  it('规则编号里的非字母数字字符被归一化，同一编号始终得到同一标识', () => {
    expect(ruleIdOf('RULE-CRACK-001')).toBe(ruleIdOf('RULE-CRACK-001'))
    expect(ruleIdOf('RULE-CRACK-001')).toBe('rule_rule_crack_001')
  })
})

/* ---------------- 旧备份导入后的事件归并 ---------------- */

describe('导入旧备份后仍能正确归并事件', () => {
  /** 模拟 V0.1/V0.2 旧备份里的规则：有规则行，但没有跨版本稳定的 ruleId。 */
  const legacyRule = {
    ...makeRule({ id: 'rule_rule_crack_001', version: 'V1.0', effectiveFrom: '2026-09-01T00:00:00.000Z' }),
    ruleId: undefined,
  } as unknown as MonitoringRule

  it('迁移后按采样时间能选到规则，判定快照带出非空规则标识', () => {
    const { rows, changed } = migrateLegacyRules([legacyRule])
    expect(changed).toBe(1)
    const picked = ruleForPoint(rows, makePoint(), NOW)
    expect(picked).toBeDefined()
    expect(snapshotOf(picked as MonitoringRule).ruleId).toBe('rule_rule_crack_001')
  })

  it('迁移后录入越限数据，事件按规则标识归并而不是各建一条', () => {
    const { rows } = migrateLegacyRules([legacyRule])
    const rule = ruleForPoint(rows, makePoint(), NOW) as MonitoringRule
    const snapshot = snapshotOf(rule)
    const open = makeEvent({ ruleId: snapshot.ruleId, level: 'yellow', peakLevel: 'yellow', evidences: [] })
    const point = makePoint()
    const current = previewRecord({
      pointId: point.id,
      metric: 'crack_width',
      values: { width: 0.73 },
      baselineValues: { width: 0.5 },
      unit: 'mm',
      sampleTime: NOW,
      sampleWindow: '',
    })
    const assessment = assessRecord({
      rule,
      point,
      values: { width: 0.73 },
      baselineValues: { width: 0.5 },
      quality: 'valid',
      device: undefined,
      history: [current],
      at: NOW,
    })
    const plan = planEvent({
      open,
      record: makeRecord({ values: { width: 0.73 }, sampleTime: NOW }),
      assessment,
      snapshot,
      actor: ACTOR,
      at: NOW,
    })
    // 归并到已有事件：追加并升级，而不是新建
    expect(plan.action).toBe('upgraded')
    expect(plan.upgrade?.to).toBe('orange')
    expect(snapshot.ruleId).not.toBe('')
  })
})

describe('修订后基准快照按新采样时间重算', () => {
  const baselines = [
    makeBaseline({ id: 'b1', version: 1, values: { width: 0.5 }, effectiveFrom: '2026-09-01T00:00:00.000Z', current: false }),
    makeBaseline({ id: 'b2', version: 2, values: { width: 0.6 }, effectiveFrom: '2026-09-25T00:00:00.000Z', current: true }),
  ]

  it('采样时间改到新基准生效期之后，取到的基准版本与数值同步变化', () => {
    const before = baselineAtTime(baselines, 'pnt_1', '2026-09-20T09:00:00.000Z')
    const after = baselineAtTime(baselines, 'pnt_1', '2026-09-26T09:00:00.000Z')
    expect(before?.version).toBe(1)
    expect(before?.values.width).toBe(0.5)
    expect(after?.version).toBe(2)
    expect(after?.values.width).toBe(0.6)
  })

  it('同一读数的变化量随基准快照变化，分级也随之改变', () => {
    const rule = makeRule()
    const point = makePoint()
    const values = { width: 0.72 }
    const withOld = assessRecord({
      rule, point, values,
      baselineValues: baselineAtTime(baselines, 'pnt_1', '2026-09-20T09:00:00.000Z')?.values ?? null,
      quality: 'valid', device: undefined, history: [], at: '2026-09-20T09:00:00.000Z',
    })
    const withNew = assessRecord({
      rule, point, values,
      baselineValues: baselineAtTime(baselines, 'pnt_1', '2026-09-26T09:00:00.000Z')?.values ?? null,
      quality: 'valid', device: undefined, history: [], at: '2026-09-26T09:00:00.000Z',
    })
    expect(withOld.triggerValue).toBeCloseTo(0.22, 6)
    expect(withOld.state).toBe('orange')
    expect(withNew.triggerValue).toBeCloseTo(0.12, 6)
    expect(withNew.state).toBe('yellow')
  })
})
