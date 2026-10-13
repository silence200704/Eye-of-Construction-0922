/**
 * 看板口径（与问筑瞳同源）。
 *
 * 这一组守两件事：
 * 1. 看板卡片、异常队列与小瞳回答**读同一份选择器**，计数不会各说各的；
 * 2. 没有设备心跳时，界面上不出现把"人工登记"写成实时状态的措辞。
 */
import { describe, expect, it } from 'vitest'
import { buildSnapshot, bySeverity, openEvents, overviewOf } from '@/assistant/selectors'
import { dashboardSummaryOf, useDashboardSnapshot } from '@/components/dashboard/liveSnapshot'
import { db } from '@/db/database'
import { deviceStatusText, EMPTY_NOTE, NO_HEARTBEAT_NOTE } from '@/components/dashboard/text'
import { DEVICE_HEALTH_OPTIONS } from '@/types/catalog'
import { makeEvent, makePoint, makeRecord } from '../fixtures'
import { setupHarness } from '../assistant/harness'

describe('看板与问答的口径一致', () => {
  it('筛选楼栋或测点后，摘要时间和事件数也只统计当前范围', async () => {
    await setupHarness({
      points: [makePoint(), makePoint({ id: 'pnt_2', code: 'B01-F2-CRACK02' })],
      records: [
        makeRecord({ id: 'rec_1', pointId: 'pnt_1', sampleTime: '2026-09-15T10:00:00.000Z' }),
        makeRecord({ id: 'rec_2', pointId: 'pnt_2', sampleTime: '2026-09-19T10:00:00.000Z' }),
      ],
      events: [
        makeEvent({ id: 'e1', pointId: 'pnt_1' }),
        makeEvent({ id: 'e2', pointId: 'pnt_2' }),
      ],
    })
    const summary = dashboardSummaryOf(buildSnapshot(), ['pnt_1'])
    expect(summary.sample).toBe('2026-09-15T10:00:00.000Z')
    expect(summary.openTotal).toBe(1)
  })

  it('看板保持打开时，重新加载的事件会触发快照重算', async () => {
    const h = await setupHarness({ events: [] })
    const live = useDashboardSnapshot()
    expect(openEvents(live.value.events)).toHaveLength(0)
    await db.events.add(makeEvent({ id: 'new-live-event', eventNo: 'E20260920-009', level: 'red', peakLevel: 'red' }))
    await h.events.load()
    expect(openEvents(live.value.events).map((row) => row.id)).toEqual(['new-live-event'])
  })

  it('未关闭事件数：概况计数、队列长度、按等级汇总三者相等', async () => {
    await setupHarness({
      events: [
        makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'red', peakLevel: 'red' }),
        makeEvent({ id: 'e2', eventNo: 'E20260920-002', level: 'yellow', peakLevel: 'orange' }),
        makeEvent({ id: 'e3', eventNo: 'E20260920-003', level: 'red', status: 'closed' }),
      ],
    })
    const snapshot = buildSnapshot()
    const overview = overviewOf(snapshot)
    const queue = bySeverity(openEvents(snapshot.events))

    expect(overview.openTotal).toBe(queue.length)
    expect(overview.openByLevel.red + overview.openByLevel.orange + overview.openByLevel.yellow).toBe(queue.length)
    expect(queue.some((row) => row.id === 'e3')).toBe(false)
  })

  it('卡片与队列拿到的是同一条事件（同一个 ID、同一个等级、同一个测点）', async () => {
    await setupHarness({
      events: [makeEvent({ id: 'e1', eventNo: 'E20260920-001', level: 'orange', peakLevel: 'orange', pointId: 'pnt_1' })],
    })
    const snapshot = buildSnapshot()
    const fromQueue = bySeverity(openEvents(snapshot.events))[0]
    const fromSnapshot = snapshot.events.find((row) => row.id === fromQueue.id)
    expect(fromSnapshot?.eventNo).toBe('E20260920-001')
    expect(fromSnapshot?.level).toBe('orange')
    expect(fromSnapshot?.pointId).toBe('pnt_1')
  })
})

describe('设备状态措辞（不得写成实时状态）', () => {
  it('三种人工登记状态都不出现裸的"在线"', () => {
    for (const health of ['unknown', 'online', 'offline', 'none'] as const) {
      const text = deviceStatusText(health)
      expect(text).not.toMatch(/^(?!人工登记).*在线/)
      expect(text.length).toBeGreaterThan(0)
    }
    expect(deviceStatusText('unknown')).toContain('无设备心跳')
    expect(deviceStatusText('online')).toContain('人工登记')
    expect(deviceStatusText('offline')).toContain('人工登记')
  })

  it('档案里的健康字段本身可以有"在线"字样（人工填的），但看板不再原样照搬', () => {
    const label = DEVICE_HEALTH_OPTIONS.find((row) => row.value === 'online')?.label ?? ''
    expect(label).toContain('在线')
    expect(deviceStatusText('online')).not.toBe(label)
  })

  it('空态与无心跳说明不把"没数据"说成"正常"', () => {
    expect(EMPTY_NOTE.noReading).not.toContain('正常')
    expect(NO_HEARTBEAT_NOTE).not.toContain('正常')
  })
})
