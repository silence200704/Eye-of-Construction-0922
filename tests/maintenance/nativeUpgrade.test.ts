/**
 * 浏览器原生 IndexedDB 物理版本 40（应用 v4）升级回归。
 *
 * `schema.test.ts` 覆盖 Dexie v4→v7；这里故意用原生 IndexedDB 写出物理版本 40 的应用 v4 旧库，
 * 再由应用自己的 ZhutongDatabase 打开。这样能锁住冻结验收中发现的
 * "旧行字段少，升级后白屏或业务表看似归零" 这条真实路径。
 */
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { ZhutongDatabase } from '@/db/database'
import { createNativeApplicationV4 } from './upgrade/legacyDb'

const name = 'zhutong-native-v4-upgrade-probe'

afterEach(async () => {
  await Dexie.delete(name)
})

describe('原生 IndexedDB v4 升级到应用 v7', () => {
  it('保留事件、巡检计划和问题，并补齐启动所需的旧字段默认值', async () => {
    await createNativeApplicationV4(name)
    const current = new ZhutongDatabase(name)
    await current.open()

    expect((await current.buildings.get('b_old'))?.name).toBe('旧库实验楼')
    expect((await current.records.get('r_old'))?.recordNo).toBe('R-OLD-001')
    expect(await current.events.count()).toBe(1)
    expect(await current.plans.count()).toBe(1)
    expect(await current.issues.count()).toBe(1)

    const event = await current.events.get('e_old')
    const plan = await current.plans.get('plan_old')
    const issue = await current.issues.get('iss_old')
    expect(event?.evidences).toEqual([])
    expect(event?.timeline).toEqual([])
    expect(plan?.floorIds).toEqual([])
    expect(plan?.checklist).toEqual([])
    expect(issue?.photos).toEqual([])
    expect(issue?.timeline).toEqual([])
    current.close()
  })
})
