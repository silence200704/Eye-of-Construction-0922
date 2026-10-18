/**
 * 阶段 4 · 旧新判定引擎共同样例。
 *
 * 同一份 JSON 同时驱动 `core/assess/engine.ts`（旧引擎）与后端 Python 引擎；
 * 这里只验证旧引擎，后端测试读同一文件验证新引擎。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assessRecord } from '@/core/assess/engine'
import { checkReading } from '@/core/validate'
import type { Device, MetricValues, MonitorRecord } from '@/types/domain'
import type { MonitoringRule } from '@/types/rules'

interface Sample {
  name: string
  rule: string
  rulePatch?: Partial<MonitoringRule>
  point: { id: string; metric: string; buildingId: string }
  values: MetricValues
  baselineValues: MetricValues | null
  quality: 'valid' | 'suspect' | 'invalid'
  device: Device | null
  history: Array<Record<string, unknown>>
  at: string
  expected: Record<string, unknown>
}

interface ValidationSample {
  name: string
  point: { id: string; metric: string; buildingId: string }
  input: Record<string, unknown>
  existing: Array<Record<string, unknown>>
  expected: Record<string, unknown>
}

const fixture = JSON.parse(
  readFileSync(new URL('./assessment-samples.json', import.meta.url), 'utf8'),
) as {
  rules: Record<string, MonitoringRule>
  samples: Sample[]
  validations: ValidationSample[]
}

function ruleOf(sample: Sample): MonitoringRule {
  return { ...structuredClone(fixture.rules[sample.rule]), ...(sample.rulePatch ?? {}) }
}

describe('共同样例：旧引擎', () => {
  it.each(fixture.samples.map((sample) => [sample.name, sample] as const))('%s', (_name, sample) => {
    const result = assessRecord({
      rule: ruleOf(sample),
      point: sample.point as never,
      values: sample.values,
      baselineValues: sample.baselineValues,
      quality: sample.quality,
      device: sample.device ?? undefined,
      history: sample.history as unknown as MonitorRecord[],
      at: sample.at,
    })
    const expected = sample.expected
    expect(result.state).toBe(expected.state)
    if (typeof expected.triggerValue === 'number') expect(result.triggerValue).toBeCloseTo(expected.triggerValue, 6)
    if (typeof expected.baselineValue === 'number') expect(result.baselineValue).toBeCloseTo(expected.baselineValue, 6)
    if (typeof expected.reasonContains === 'string') expect(result.reason).toContain(expected.reasonContains)
    if (typeof expected.basisContains === 'string') expect(result.basis).toContain(expected.basisContains)
    if (typeof expected.insufficientContains === 'string') {
      expect(result.insufficientReason).toContain(expected.insufficientContains)
    }
  })
})

describe('共同样例：录入校验', () => {
  it.each(fixture.validations.map((sample) => [sample.name, sample] as const))('%s', (_name, sample) => {
    const input = sample.input as Record<string, unknown>
    const check = checkReading(
      {
        ...(input as never),
        pointId: sample.point.id,
        metric: sample.point.metric,
        device: (input.device ?? undefined) as Device | undefined,
      },
      sample.existing as unknown as MonitorRecord[],
    )
    const expected = sample.expected
    expect(check.issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(expected.issueFields as string[]))
    for (const fragment of expected.issueContains as string[]) {
      expect(check.issues.map((issue) => issue.message).join('；')).toContain(fragment)
    }
    if (typeof expected.outOfRange === 'boolean') expect(check.outOfRange).toBe(expected.outOfRange)
    if (typeof expected.backfill === 'boolean') expect(check.backfill).toBe(expected.backfill)
  })
})
