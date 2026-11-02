/**
 * 问筑瞳 · 真实示例数据集。
 *
 * 前面的用例都用夹具，这一组用项目自带的示例校区数据跑一遍，
 * 证明回答读的是**当前数据集**而不是写死的演示数字：
 * 断言里的期望值全部从 `seedDataset()` 自己算出来，不抄任何一个具体数字。
 *
 * 补录与修订标记另有用例覆盖（`pointStatus.test.ts`），这里不重复。
 */
import { describe, expect, it } from 'vitest'
import { seedDataset } from '@/db/seed'
import { makeBaseline, makeBuilding, makeDevice, makeFloor, makePoint, makeRule } from '../../fixtures'
import { setupHarness, type DatasetInput } from '../harness'

function seedInput(): DatasetInput {
  const data = seedDataset()
  return {
    buildings: data.buildings,
    floors: data.floors,
    points: data.points,
    devices: data.devices,
    baselines: data.baselines,
    records: data.records,
    rules: data.rules,
    events: data.events,
  }
}

describe('示例数据集下的回答', () => {
  it('概况计数由当前数据集算出，与档案一致', async () => {
    const data = seedDataset()
    const h = await setupHarness(seedInput())
    const asked = await h.ask('全校现在监测如何')
    const facts = asked.facts.map((row) => `${row.label}=${row.value}`).join('\n')

    const activePoints = data.points.filter((row) => row.status === 'active')
    const sensorPoints = activePoints.filter((row) => row.metric !== 'inspection')
    expect(facts).toContain(`在册楼栋=${data.buildings.filter((row) => row.status === 'active').length}`)
    expect(facts).toContain(`在册测点=${activePoints.length}`)
    expect(facts).toContain(`其中传感器测点=${sensorPoints.length}`)
    // 来源构成之和等于记录总数：不丢也不算重
    const manual = data.records.filter((row) => row.source === 'manual').length
    const device = data.records.filter((row) => row.source === 'device').length
    expect(manual).toBe(0)
    expect(device).toBe(data.records.length)
    expect(data.records.some((row) => row.isBackfill)).toBe(true)
    expect(facts).toContain(`人工录入 ${manual}｜CSV 导入 0｜传感器数据（演示）${device}`)
  })

  it('空库后重问，同一句话的数字随之归零', async () => {
    const h = await setupHarness(seedInput())
    const before = await h.ask('全校现在监测如何')
    const sourceLine = before.facts.find((row) => row.label === '记录来源构成')
    expect(sourceLine?.value).toContain(`传感器数据（演示）${seedDataset().records.length}`)

    const empty = await setupHarness({
      buildings: [makeBuilding()],
      floors: [makeFloor()],
      points: [makePoint()],
      devices: [makeDevice()],
      baselines: [makeBaseline()],
      rules: [makeRule()],
      records: [],
      events: [],
    })
    const after = await empty.ask('全校现在监测如何')
    const facts = after.facts.map((row) => `${row.label}=${row.value}`).join('\n')
    expect(facts).toContain('在册测点=1')
    expect(facts).toContain('有有效读数的传感器测点=0 / 1')
  })

  it('采样时间取自该测点最新一条有效记录，而不是最早或任意一条', async () => {
    const data = seedDataset()
    // 挑一个有多条有效记录的测点，避免依赖具体编号
    const candidates = data.points
      .map((point) => ({ point, rows: data.records.filter((row) => row.pointId === point.id && row.quality === 'valid') }))
      .filter((item) => item.rows.length > 1)
    if (candidates.length === 0) throw new Error('种子数据里没有多条有效记录的测点，这条用例需要跟着调整')

    const target = candidates[0]
    const newest = [...target.rows].sort((a, b) => a.sampleTime.localeCompare(b.sampleTime))[target.rows.length - 1]
    const h = await setupHarness(seedInput())
    const result = await h.ask(`${target.point.code} 怎么样`)

    expect(result.status).toBe('answered')
    expect(result.timing?.sampleTime).toBe(newest.sampleTime)
    expect(result.timing?.enteredAt).toBe(newest.enteredAt)
    expect(result.evidence[0].ref).toBe(newest.recordNo)
  })
})
